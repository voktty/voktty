import { IS_WINDOWS } from "@/lib/platform";
import type { IMarker, Terminal } from "@xterm/xterm";
import {
  parseOsc9Progress,
  type Osc9Progress,
} from "./terminalProgressStore";

const MAX_OSC52_CLIPBOARD_BYTES = 1024 * 1024;

/**
 * Cross-handler state shared between the OSC 7 cwd handler and the OSC 133
 * prompt-marker handler. Tracks whether we are currently inside a running
 * command (between OSC 133 B and the next OSC 133 D / A), so the cwd handler
 * can ignore OSC 7 updates emitted by *command output* (e.g. a remote SSH
 * server, a `cat` of an attacker-controlled file). Only OSC 7 issued by the
 * local shell — which fires between commands — should be honored.
 */
export type ShellIntegrationState = {
  inCommand: boolean;
};

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
  state?: ShellIntegrationState,
): () => void {
  const d = term.parser.registerOscHandler(7, (data) => {
    // Reject OSC 7 emitted while a command is running: command stdout/stderr
    // is untrusted (it can come from a remote shell, an SSH session, a `cat`
    // of attacker-controlled bytes). The local shell only emits OSC 7
    // between commands via its precmd/PROMPT_COMMAND hook.
    if (state?.inCommand) return true;
    const cwd = parseOsc7(data);
    if (cwd) onCwd(cwd);
    return true;
  });
  return () => d.dispose();
}

export type PromptTracker = {
  getMarker: () => IMarker | null;
  dispose: () => void;
};

export function registerPromptTracker(
  term: Terminal,
  state?: ShellIntegrationState,
  // Fires on C (process executing) and A/D (back at prompt). Distinct from
  // inCommand, which is already true from B while the user merely types.
  onCommandState?: (running: boolean, exitCode?: number | null) => void,
): PromptTracker {
  let marker: IMarker | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    // OSC 133 A — start of new prompt (between commands).
    if (data.startsWith("A")) {
      if (state) state.inCommand = false;
      onCommandState?.(false);
      marker?.dispose();
      marker = term.registerMarker(0);
    } else if (data.startsWith("B")) {
      // OSC 133 B — command begins. From here on, treat all output as
      // untrusted until we see D (command exit) or the next A (new prompt).
      if (state) state.inCommand = true;
    } else if (data.startsWith("C")) {
      // OSC 133 C — command pre-execution marker; still inside command.
      if (state) state.inCommand = true;
      onCommandState?.(true);
    } else if (data.startsWith("D")) {
      // OSC 133 D — command ends.
      if (state) state.inCommand = false;
      const rest = data.length > 2 && data[1] === ";" ? data.slice(2) : "";
      const code = rest ? parseInt(rest, 10) : null;
      const exitCode = Number.isFinite(code) ? code : null;
      onCommandState?.(false, exitCode);
    }
    return true;
  });
  return {
    getMarker: () => (marker && !marker.isDisposed ? marker : null),
    dispose: () => {
      d.dispose();
      marker?.dispose();
      marker = null;
    },
  };
}

export function registerOsc9ProgressHandler(
  term: Terminal,
  onProgress: (progress: Osc9Progress) => void,
): () => void {
  const d = term.parser.registerOscHandler(9, (data) => {
    const p = parseOsc9Progress(data);
    if (p) {
      onProgress(p);
      return true;
    }
    return false;
  });
  return () => d.dispose();
}

export type ClipboardWriter = (text: string) => void | Promise<void>;

export function registerOsc52ClipboardHandler(
  term: Terminal,
  writeClipboard: ClipboardWriter = writeSystemClipboard,
): () => void {
  const d = term.parser.registerOscHandler(52, (data) => {
    const text = parseOsc52Clipboard(data);
    if (text === null) return true;
    queueMicrotask(() => {
      try {
        void Promise.resolve(writeClipboard(text)).catch(() => {});
      } catch {}
    });
    return true;
  });
  return () => d.dispose();
}

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/([^/]*)(\/.*)$/);
  if (!m) return null;
  const host = m[1];
  let path = m[2];
  try {
    path = decodeURIComponent(path);
  } catch {}
  if (IS_WINDOWS) {
    if (/^\/\?\/UNC\//i.test(path)) {
      path = `//${path.slice(8)}`;
    } else if (/^\/\?\/[A-Za-z]:/i.test(path)) {
      path = path.slice(3);
    }
  }
  // /C:/Users/foo -> C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  } else if (IS_WINDOWS && (!host || host.toLowerCase() === "localhost")) {
    // git-bash (MSYS) reports cwd as /c/Users/foo; map it to C:/Users/foo only for localhost
    // and when not referring to top-level unix directories like /var, /root, /home, /opt, /usr, /srv, /etc.
    const drive = path.match(/^\/([A-Za-z])(\/.*)?$/);
    if (drive && !/^\/(var|etc|home|root|usr|opt|srv|tmp|proc|sys|dev)(\/|$)/i.test(path)) {
      path = `${drive[1].toUpperCase()}:${drive[2] ?? "/"}`;
    }
  }
  return path;
}

function parseOsc52Clipboard(data: string): string | null {
  const parts = data.split(";");
  if (parts.length < 2) return null;
  const selection = parts[0] || "c";
  if (!selection.includes("c")) return null;
  const encoded = parts.slice(1).join(";");
  if (!encoded || encoded === "?") return null;
  if (encoded.length > Math.ceil((MAX_OSC52_CLIPBOARD_BYTES * 4) / 3) + 4) {
    return null;
  }
  const compact = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;

  try {
    const bytes = Uint8Array.from(atob(compact), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_OSC52_CLIPBOARD_BYTES) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function writeSystemClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
