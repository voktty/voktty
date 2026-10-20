/**
 * Reads in flight, one per key. A provider that is slow must not hold back the
 * others, so callers ask about their own key and only wait on all of them for
 * operations that need the footer quiet (sign-in, reset).
 */
export function createInflightTracker<K extends string>() {
  const running = new Map<K, Promise<void>>();

  return {
    has: (key: K): boolean => running.has(key),
    get: (key: K): Promise<void> | undefined => running.get(key),
    get size(): number {
      return running.size;
    },
    /** Registers `work` under `key`; the returned promise never rejects. */
    track(key: K, work: Promise<unknown>): Promise<void> {
      const tracked: Promise<void> = work
        .then(
          () => undefined,
          () => undefined,
        )
        .finally(() => {
          if (running.get(key) === tracked) running.delete(key);
        });
      running.set(key, tracked);
      return tracked;
    },
    /** Resolves once nothing is in flight, including work added meanwhile. */
    async idle(): Promise<void> {
      while (running.size > 0) await Promise.all([...running.values()]);
    },
  };
}

export type InflightTracker<K extends string> = ReturnType<
  typeof createInflightTracker<K>
>;