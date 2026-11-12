import type { RemoteMultiplexerProbe } from "./types";
import type { SshConnectionConfig } from "@/modules/workspace";

export type SshMultiplexerAction =
  "attach" | "attach_force" | "grouped" | "new" | "none";

export type SshMultiplexerSelection = {
  action: SshMultiplexerAction;
  sessionName?: string;
};

const DEFAULT_MULTIPLEXER_SESSION = "voktty";

/**
 * The session an unattended connection joins or creates. Mirrors
 * `sanitize_session_name` and the name fallback in `pty/shell_init.rs`.
 */
export function automaticMultiplexerSessionName(
  connection: SshConnectionConfig,
): string {
  const raw = [
    connection.activeMultiplexerSession,
    connection.tmuxSessionName,
  ].find((name) => name !== undefined && name.trim() !== "");
  if (raw === undefined) return DEFAULT_MULTIPLEXER_SESSION;
  const sanitized = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.trim() === "" ? DEFAULT_MULTIPLEXER_SESSION : sanitized;
}

/**
 * Ask whenever connecting without asking would skip an existing session:
 * the automatic path only joins the session it would otherwise create, so
 * any other session on the host would be passed over silently.
 */
export function shouldPickSshMultiplexer(
  connection: SshConnectionConfig,
  probe: RemoteMultiplexerProbe,
): boolean {
  if (!probe.supported || connection.multiplexerMode === "none") return false;
  if (connection.multiplexerMode === "ask") return true;
  if (probe.sessions.length === 0) return false;
  if (
    probe.sessions.some(
      (session) => session.isAttached || session.attachedCount > 0,
    )
  ) {
    return true;
  }
  return !(
    probe.sessions.length === 1 &&
    probe.sessions[0].name === automaticMultiplexerSessionName(connection)
  );
}

export function sshMultiplexerSettingsForSelection(
  connection: SshConnectionConfig,
  selection: SshMultiplexerSelection,
): Pick<
  SshConnectionConfig,
  "multiplexerMode" | "activeMultiplexerSession" | "multiplexerAction"
> {
  return {
    multiplexerMode:
      selection.action === "none"
        ? "none"
        : (connection.multiplexerMode ?? "auto"),
    activeMultiplexerSession: selection.sessionName,
    multiplexerAction:
      selection.action === "none" ? undefined : selection.action,
  };
}
