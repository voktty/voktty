import { useCallback, useLayoutEffect, useRef } from "react";

const CAPACITY = 256;
const DEADLINE_MS = 2500;

export function useHarnessViewActivation(ready: boolean, request: () => void) {
  const state = useRef<{
    ready: boolean;
    pending: Set<(confirmed: boolean) => void>;
  } | null>(null);
  const latest = useRef(request);
  latest.current = request;
  useLayoutEffect(() => {
    const owner = {
      ready: false,
      pending: new Set<(confirmed: boolean) => void>(),
    };
    state.current = owner;
    return () => {
      if (state.current === owner) state.current = null;
      for (const finish of [...owner.pending]) finish(false);
    };
  }, []);
  useLayoutEffect(() => {
    const owner = state.current;
    if (!owner) return;
    owner.ready = ready;
    if (ready) for (const finish of [...owner.pending]) finish(true);
  }, [ready]);
  return useCallback((): Promise<boolean> => {
    const owner = state.current;
    if (!owner || owner.pending.size >= CAPACITY) return Promise.resolve(false);
    if (owner.ready) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (confirmed: boolean) => {
        if (!owner.pending.delete(finish)) return;
        clearTimeout(timer);
        resolve(confirmed && state.current === owner);
      };
      owner.pending.add(finish);
      timer = setTimeout(() => finish(false), DEADLINE_MS);
      try {
        latest.current();
      } catch {
        finish(false);
      }
    });
  }, []);
}
