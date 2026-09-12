import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import {
  getPtyStatus,
  killPty,
  resizePty,
  spawnPty,
  subscribePty,
  writePty,
} from "../lib/pty";
import { isOscColorQuery, oscColorReply } from "../lib/terminalChrome";
import {
  defaultTerminalTitle,
  scanOscCwd,
  type TerminalMetaPatch,
} from "../lib/terminalTab";
import { THEME_CHANGED_EVENT } from "@/modules/theme/ThemeProvider";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { readTerminalTokens } from "@/styles/tokens";
import {
  applyTerminalChrome,
  fitTerminal,
  resetGridStretch,
  type TerminalFitMode,
} from "../lib/terminalLayout";
import { IS_MAC } from "../lib/platform";
import "@xterm/xterm/css/xterm.css";

type Props = {
  id: string;
  cwd: string;
  active: boolean;
  onMetaChange?: (patch: TerminalMetaPatch) => void;
};

function monoFont(): string {
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
  return fromCss || "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
}

function oscColor(value: string, fallback: string): string {
  const hex = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const rgb = hex.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (!rgb) return fallback;
  return `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

function oscColors() {
  const tokens = readTerminalTokens();
  return {
    fg: oscColor(tokens.foreground, "#f4f4f6"),
    bg: oscColor(tokens.background, "#121214"),
    cursor: oscColor(tokens.cursor, "#0a84ff"),
  };
}

export function TerminalView({ id, cwd, active, onMetaChange }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const spawned = useRef(false);
  const applySizeRef = useRef<() => void>(() => {});
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const runningProcessRef = useRef<string | null>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const host = hostRef.current;
    if (!outer || !host) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: monoFont(),
      fontSize: 13,
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 5000,
      allowTransparency: true,
      smoothScrollDuration: 0,
      theme: buildTerminalTheme(),
      macOptionIsMeta: IS_MAC,
    });
    term.open(host);
    termRef.current = term;
    let closed = false;

    const onCopy = (event: ClipboardEvent) => {
      const text = term.getSelection();
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      term.paste(text);
    };
    host.addEventListener("copy", onCopy);
    host.addEventListener("paste", onPaste);

    term.attachCustomKeyEventHandler((event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return true;
      const key = event.key.toLowerCase();
      if (key === "c") {
        if (term.hasSelection()) return false;
        if (event.metaKey && !event.ctrlKey) return false;
        return true;
      }
      if (key === "v") return false;
      return true;
    });

    let oscBuffer = "";

    const unsubscribe = subscribePty(
      id,
      (data) => {
        const onMeta = onMetaChangeRef.current;
        if (onMeta) {
          const text = new TextDecoder().decode(data);
          const scanned = scanOscCwd(text, oscBuffer);
          oscBuffer = scanned.rest;
          if (scanned.cwd) {
            const patch: TerminalMetaPatch = { cwd: scanned.cwd };
            if (!runningProcessRef.current) {
              patch.title = defaultTerminalTitle(scanned.cwd);
            }
            onMeta(patch);
          }
        }
        term.write(data);
      },
      (code) => {
        if (closed) return;
        const status = code == null ? "" : ` (${code})`;
        term.writeln(`\r\n[process exited${status}]`);
      },
    );

    const dataSub = term.onData((data) => {
      void writePty(id, data);
    });

    const replyOsc = (code: 10 | 11 | 12, hex: string) => {
      const reply = oscColorReply(code, hex);
      if (reply) void writePty(id, reply);
      return true;
    };
    const oscFg = term.parser.registerOscHandler(10, (data) =>
      isOscColorQuery(data) ? replyOsc(10, oscColors().fg) : false,
    );
    const oscBg = term.parser.registerOscHandler(11, (data) =>
      isOscColorQuery(data) ? replyOsc(11, oscColors().bg) : false,
    );
    const oscCursor = term.parser.registerOscHandler(12, (data) =>
      isOscColorQuery(data) ? replyOsc(12, oscColors().cursor) : false,
    );

    const onSchemeChange = () => {
      term.options.theme = buildTerminalTheme();
    };
    window.addEventListener(THEME_CHANGED_EVENT, onSchemeChange);

    term.attachCustomWheelEventHandler(() => {
      if (term.element?.classList.contains("enable-mouse-events")) return true;
      return term.buffer.active.type !== "alternate";
    });

    let lastCols = 0;
    let lastRows = 0;
    let raf = 0;
    let tuiMode = false;

    const fitMode = (): TerminalFitMode =>
      term.buffer.active.type === "alternate" ? "tui" : "shell";

    const syncAltScreenMode = () => {
      const next = fitMode() === "tui";
      if (next === tuiMode) return;
      tuiMode = next;
      applyTerminalChrome(term, outer, next);
      if (!next) resetGridStretch(term);
      lastCols = 0;
      lastRows = 0;
      schedule();
    };

    const applySize = () => {
      if (closed) return;
      const next = fitTerminal(term, host, fitMode());
      if (!next) return;
      const { cols, rows } = next;
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      if (!spawned.current) {
        spawned.current = true;
        void spawnPty(id, cwd, cols, rows).catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          term.writeln(`\x1b[31m${message}\x1b[0m`);
        });
        return;
      }
      void resizePty(id, cols, rows);
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applySize();
      });
    };

    applySizeRef.current = applySize;
    const renderSub = term.onRender(() => {
      if (!spawned.current) applySize();
    });
    const bufferSub = term.buffer.onBufferChange(syncAltScreenMode);
    syncAltScreenMode();
    const frame = requestAnimationFrame(applySize);
    const observer = new ResizeObserver(schedule);
    observer.observe(host);

    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      outer.classList.remove("monocode-terminal--alt-screen");
      applySizeRef.current = () => {};
      host.removeEventListener("copy", onCopy);
      host.removeEventListener("paste", onPaste);
      window.removeEventListener(THEME_CHANGED_EVENT, onSchemeChange);
      dataSub.dispose();
      oscFg.dispose();
      oscBg.dispose();
      oscCursor.dispose();
      renderSub.dispose();
      bufferSub.dispose();
      unsubscribe();
      void killPty(id);
      term.dispose();
      termRef.current = null;
      spawned.current = false;
    };
  }, [id]);

  // Identity-stable: the callers pass an inline arrow, so depending on the
  // prop itself would tear down and re-arm the poll — and re-fork `ps` — on
  // every parent render.
  const wantsMeta = !!onMetaChange;

  useEffect(() => {
    if (!wantsMeta) return;
    let lastForeground: string | null = null;
    let inFlight = false;
    const refresh = () => {
      if (!spawned.current) return;
      // Each status read forks `ps`; an off-screen window has no title to paint.
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      void getPtyStatus(id)
        .then(({ foreground }) => {
          const fg = foreground?.trim() || null;
          runningProcessRef.current = fg;
          if (fg === lastForeground) return;
          lastForeground = fg;
          onMetaChangeRef.current?.(
            fg
              ? { title: fg, foreground: fg }
              : { title: defaultTerminalTitle(cwd), foreground: null },
          );
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const interval = setInterval(refresh, 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, cwd, wantsMeta]);

  useEffect(() => {
    if (!active) return;
    applySizeRef.current();
    termRef.current?.focus();
  }, [active]);

  return (
    <div
      ref={outerRef}
      className="monocode-terminal flex h-full w-full min-h-0 min-w-0 flex-col"
      onMouseDown={() => termRef.current?.focus()}
    >
      <div
        ref={hostRef}
        className="monocode-terminal-host min-h-0 min-w-0 flex-1 overflow-hidden"
      />
    </div>
  );
}
