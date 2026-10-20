import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  type RemoteSessionInfo,
  type RemoteSshConnection,
} from "./client";
import { RemoteSessionPool, type RemoteSessionLease } from "./sessionPool";

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

/** Surfaces that keep a session by numeric id until they close it. */
export type SessionHolder = "workspace" | "harness" | "agent";

const holds = new Map<
  number,
  Array<{ holder: SessionHolder; lease: RemoteSessionLease }>
>();

/**
 * Opens a session that the caller keeps until it calls
 * `closeRemoteSessionById` with the same holder. Surfaces that address
 * sessions by id (workspace terminals, the Harness environment) use this to
 * share one session per profile and root with every other consumer.
 */
export async function openHeldRemoteSession(
  holder: SessionHolder,
  profileId: string,
  connection: RemoteSshConnection,
  root: string,
): Promise<RemoteSessionInfo> {
  const lease = await remoteSessions.acquire({ profileId, root }, connection);
  const id = lease.info.session_id;
  holds.set(id, [...(holds.get(id) ?? []), { holder, lease }]);
  return lease.info;
}

/**
 * Releases exactly one hold of `holder`, for holders that keep one hold per
 * user (each running agent). The session closes once nothing else uses it.
 */
export async function releaseHeldRemoteSession(
  holder: SessionHolder,
  sessionId: number,
): Promise<void> {
  const all = holds.get(sessionId) ?? [];
  const index = all.findIndex((hold) => hold.holder === holder);
  if (index < 0) return;
  const [hold] = all.splice(index, 1);
  if (all.length > 0) holds.set(sessionId, all);
  else holds.delete(sessionId);
  hold.lease.release();
  const entry = remoteSessions
    .snapshot()
    .find((candidate) => candidate.sessionId === sessionId);
  if (entry && entry.leases <= 0) await remoteSessions.closeSession(sessionId);
}

/**
 * Drops every hold of `holder` on the session and closes it as soon as no
 * other consumer uses it. Each holder tracks its own users, so one close
 * releases all of that holder's holds. A session that was never pooled is
 * closed directly.
 */
export async function closeRemoteSessionById(
  holder: SessionHolder,
  sessionId: number,
): Promise<void> {
  const all = holds.get(sessionId) ?? [];
  const mine = all.filter((hold) => hold.holder === holder);
  const rest = all.filter((hold) => hold.holder !== holder);
  if (rest.length > 0) holds.set(sessionId, rest);
  else holds.delete(sessionId);
  const entry = remoteSessions
    .snapshot()
    .find((candidate) => candidate.sessionId === sessionId);
  if (!entry) {
    if (all.length === 0) await closeRemoteWorkspace(sessionId);
    return;
  }
  for (const hold of mine) hold.lease.release();
  if (entry.leases - mine.length <= 0) await remoteSessions.closeSession(sessionId);
}