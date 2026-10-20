import { closeRemoteWorkspace, openRemoteWorkspace } from "./client";
import { RemoteSessionPool } from "./sessionPool";

const IDLE_CLOSE_MS = 30_000;

/** The single owner of reusable helper sessions for file, Git and agent work. */
export const remoteSessions = new RemoteSessionPool({
  open: (connection, root) => openRemoteWorkspace(connection, root),
  close: (sessionId) => closeRemoteWorkspace(sessionId),
  idleMs: IDLE_CLOSE_MS,
  schedule: (task, delayMs) => {
    const timer = setTimeout(task, delayMs);
    return () => clearTimeout(timer);
  },
});