import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";

type Source = Readonly<{
  source: string;
  target: MemoryPanelTarget | null;
  captureConversation: () => MemoryConversationCapture | null;
  isCurrent: () => boolean;
}>;
export type MemorySurface = Source & Readonly<{ revision: number }>;

export function createMemorySurfaceRegistry() {
  let current: MemorySurface | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        /* Observers cannot retain a retired source. */
      }
    }
  };
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      if (!listeners.has(listener) && listeners.size >= 256)
        throw new RangeError("Memory surface observer capacity exceeded");
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(source: Source) {
      if (!Number.isSafeInteger(revision + 1))
        throw new RangeError("Memory surface revision exhausted");
      let live = true;
      const captureConversation = source.captureConversation;
      const check = source.isCurrent;
      const target = source.target ? structuredClone(source.target) : null;
      const isCurrent = () => {
        if (!live || current !== receipt) return false;
        if (!check()) live = false;
        return live;
      };
      const receipt: MemorySurface = Object.freeze({
        source: source.source,
        target,
        revision: ++revision,
        isCurrent,
        captureConversation: () => (isCurrent() ? captureConversation() : null),
      });
      current = receipt;
      notify();
      return () => {
        live = false;
        if (current !== receipt) return;
        current = null;
        notify();
      };
    },
  };
}

export const memorySurfaceRegistry = createMemorySurfaceRegistry();
