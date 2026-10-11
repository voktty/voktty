import type { RemoteMultiplexerProbe } from "./types";
import type { SshConnectionConfig } from "@/modules/workspace";

export type SshMultiplexerAction =
  "attach" | "attach_force" | "grouped" | "new" | "none";

export type SshMultiplexerSelection = {
  action: SshMultiplexerAction;
  sessionName?: string;
};

export function shouldPickSshMultiplexer(
  connection: SshConnectionConfig,
  probe: RemoteMultiplexerProbe,
): boolean {
  if (!probe.supported || connection.multiplexerMode === "none") return false;
  return (
    connection.multiplexerMode === "ask" ||
    probe.sessions.length > 1 ||
    probe.sessions.some(
      (session) => session.isAttached || session.attachedCount > 0,
    )
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
