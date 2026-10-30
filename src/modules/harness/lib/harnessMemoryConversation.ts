import type { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import { qualifyHarnessMemorySession } from "@/modules/harness/lib/harnessMemorySessions";
import type { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";

export function captureHarnessMemoryConversation(
  engine: Pick<
    ReturnType<typeof useHarnessSessionEngine>,
    "captureMemorySession"
  >,
  views: ReturnType<typeof createHarnessWindowViews>,
  ownerId: number,
  projectCwd: string,
  source: Readonly<{
    isCurrent: (sessionId?: string) => boolean;
    subscribe: (listener: () => void) => () => void;
  }>,
): MemoryConversationCapture | null {
  if (!source.isCurrent()) return null;
  const focus = views.captureFocusedSession(ownerId, projectCwd);
  if (!focus) return null;
  try {
    const session = engine.captureMemorySession(focus.sessionId);
    if (!session || session.projectCwd !== projectCwd) {
      focus.release();
      return null;
    }
    let active = true;
    const listeners = new Set<() => void>();
    const subscriptions: (() => void)[] = [];
    const current = () =>
      active &&
      focus.isCurrent() &&
      source.isCurrent(focus.sessionId) &&
      session.isCurrent();
    const release = () => {
      if (!active) return;
      active = false;
      focus.release();
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try {
          listener();
        } catch {
          /* Observers cannot retain an expired capture. */
        }
      }
      listeners.clear();
    };
    const changed = () => {
      if (!current()) {
        release();
        return;
      }
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try {
          listener();
        } catch {
          /* Observers cannot undo session ownership. */
        }
      }
    };
    try {
      for (const subscribe of [
        views.subscribe,
        source.subscribe,
        session.subscribe,
      ]) {
        if (!active) break;
        const unsubscribe = subscribe(changed);
        if (active) subscriptions.push(unsubscribe);
        else unsubscribe();
      }
    } catch (error) {
      release();
      throw error;
    }
    if (!current()) {
      release();
      return null;
    }
    const qualified = qualifyHarnessMemorySession(session, current);
    return Object.freeze({
      conversation: Object.freeze({
        ...qualified,
        subscribe(listener: () => void) {
          if (!current()) return () => undefined;
          if (!listeners.has(listener) && listeners.size >= 256)
            throw new RangeError("Harness memory observer capacity exceeded");
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      }),
      release,
    });
  } catch (error) {
    focus.release();
    throw error;
  }
}
