import { useSyncExternalStore } from "react";
import { remoteSessions } from "./sessionManager";
import type { RemoteSessionSnapshot } from "./sessionPool";

let current: RemoteSessionSnapshot[] = [];

function snapshot(): RemoteSessionSnapshot[] {
  const next = remoteSessions.snapshot();
  if (
    next.length !== current.length ||
    next.some((entry, index) => {
      const previous = current[index];
      return (
        entry.key.profileId !== previous.key.profileId ||
        entry.key.root !== previous.key.root ||
        entry.sessionId !== previous.sessionId ||
        entry.leases !== previous.leases ||
        entry.closing !== previous.closing ||
        entry.state.phase !== previous.state.phase ||
        entry.state.attempt !== previous.state.attempt ||
        entry.state.error !== previous.state.error
      );
    })
  )
    current = next;
  return current;
}

const subscribe = (listener: () => void) => remoteSessions.subscribe(listener);

/** Stable external-store snapshots keep native pool reads outside React memoization. */
export function useRemoteSessionSnapshots(): RemoteSessionSnapshot[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
