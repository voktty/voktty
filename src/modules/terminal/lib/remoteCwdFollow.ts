export const REMOTE_CWD_POLL_MS = 5000;
// Recover when shell integration stops reporting, including after its first prompt.
export const REMOTE_CWD_SILENCE_MS = 15_000;

export type RemoteCwdFollowInput = {
  ssh: boolean;
  hasPty: boolean;
  shellExited: boolean;
  visible: boolean;
  focused: boolean;
  agentActive: boolean;
  shellReportedCwd: boolean;
  openedForMs: number;
  lastReportAgoMs?: number;
  lookupInFlight: boolean;
};

/** Whether a remote terminal should ask the helper where its process is.
 * The shell's own report is preferred because it costs nothing and keeps the
 * path the user typed. The helper answers with the resolved physical path, so it
 * is used only where the shell cannot speak: while an agent owns the terminal,
 * or when integration has gone silent. */
export function shouldFollowRemoteCwd(input: RemoteCwdFollowInput): boolean {
  if (!input.ssh || !input.hasPty || input.shellExited) return false;
  if (!input.visible || !input.focused || input.lookupInFlight) return false;
  if (input.agentActive) return true;
  return (
    (input.shellReportedCwd
      ? (input.lastReportAgoMs ?? 0)
      : input.openedForMs) >= REMOTE_CWD_SILENCE_MS
  );
}
