import { useMemo, useSyncExternalStore } from "react";
import { remoteSessions } from "./sessionManager";
import type { RemoteSessionSnapshot } from "./sessionPool";

const signature = () =>
  remoteSessions
    .snapshot()
    .map(
      (entry) =>
        `${entry.key.profileId}|${entry.key.root}|${entry.sessionId ?? ""}|${entry.state.phase}`,
    )
    .join("\n");

/** Pool state for UI. Re-renders only when a session opens, closes or changes phase. */
export function useRemoteSessionSnapshots(): RemoteSessionSnapshot[] {
  const current = useSyncExternalStore(
    (listener) => remoteSessions.subscribe(listener),
    signature,
    signature,
  );
  // The signature is the cache key: snapshot() is rebuilt only when it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  return useMemo(() => remoteSessions.snapshot(), [current]);
}