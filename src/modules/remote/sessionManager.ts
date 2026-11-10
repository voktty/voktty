import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  type RemoteSessionInfo,
  type RemoteSshConnection,
} from "./client";
import { RemoteSessionPool, type RemoteSessionLease } from "./sessionPool";
import {
  liveRemoteSessionId,
  recordRemoteSessionReplacement,
} from "./sessionAliases";

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
  requestedId: number,
): Promise<void> {
  const sessionId = liveRemoteSessionId(requestedId);
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
  requestedId: number,
): Promise<void> {
  // A holder that kept the id of a lost session releases its replacement.
  const sessionId = liveRemoteSessionId(requestedId);
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

/** A failed recovery is not retried for this long, so a host that is down
 * costs one SSH attempt per interval instead of one per request. */
const RECOVERY_COOLDOWN_MS = 10_000;
const recoveries = new Map<number, Promise<RemoteSessionInfo>>();
const recoveryListeners = new Set<(lostId: number, sessionId: number) => void>();

/** Called after a lost session is replaced, so per-session state such as file
 * watches can be registered again on the replacement. */
export function onRemoteSessionRecovered(
  listener: (lostId: number, sessionId: number) => void,
): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}
const failedRecoveries = new Map<number, { at: number; reason: unknown }>();

/**
 * Replaces a lost helper session with a new one for the same profile and
 * root. Every holder of the lost session keeps its hold on the replacement,
 * and the replacement is recorded so stale copies of the old id reach it.
 * Concurrent callers for the same lost session share one attempt.
 */
export function recoverLostRemoteSession(
  lostId: number,
  profileId: string,
  connection: RemoteSshConnection,
  root: string,
): Promise<RemoteSessionInfo> {
  const live = liveRemoteSessionId(lostId);
  const pending = recoveries.get(live);
  if (pending) return pending;
  const failed = failedRecoveries.get(live);
  if (failed && Date.now() - failed.at < RECOVERY_COOLDOWN_MS)
    return Promise.reject(failed.reason);
  const recovery = (async () => {
    const entry = remoteSessions
      .snapshot()
      .find((candidate) => candidate.sessionId === live);
    if (entry && entry.key.profileId !== profileId)
      throw new Error("The lost remote session belongs to another connection.");
    const key = entry?.key ?? { profileId, root };
    remoteSessions.invalidate(key, live);
    const lost = holds.get(live) ?? [];
    holds.delete(live);
    const holders: SessionHolder[] = lost.length
      ? lost.map((hold) => hold.holder)
      : ["workspace"];
    const leases: Array<{ holder: SessionHolder; lease: RemoteSessionLease }> =
      [];
    try {
      for (const holder of holders) {
        leases.push({
          holder,
          lease: await remoteSessions.acquire(key, connection),
        });
      }
    } catch (reason) {
      for (const { lease } of leases) lease.release();
      throw reason;
    }
    const info = leases[0].lease.info;
    holds.set(info.session_id, [...(holds.get(info.session_id) ?? []), ...leases]);
    recordRemoteSessionReplacement(live, info.session_id);
    failedRecoveries.delete(live);
    for (const listener of recoveryListeners) {
      try {
        listener(live, info.session_id);
      } catch {
        // A listener failure must not undo a recovered session.
      }
    }
    return info;
  })();
  recoveries.set(live, recovery);
  void recovery.then(
    () => recoveries.delete(live),
    (reason) => {
      recoveries.delete(live);
      failedRecoveries.set(live, { at: Date.now(), reason });
      while (failedRecoveries.size > 64) {
        const oldest = failedRecoveries.keys().next().value;
        if (oldest === undefined) break;
        failedRecoveries.delete(oldest);
      }
    },
  );
  return recovery;
}