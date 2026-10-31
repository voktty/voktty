import type { Chat, UIMessage } from "@ai-sdk/react";
import { subscribeAiFileRoot } from "@/modules/ai/lib/aiRootObservation";
import { captureChatMemoryConversation } from "@/modules/ai/lib/chatMemoryOwner";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";
import { qualifyMemoryConversation } from "@/modules/workspace-kit/lib/memoryConversations";

let captures = 0;

export function captureAiMemoryConversation(
  chat: Chat<UIMessage>,
  root: string,
  isPresentationCurrent: () => boolean,
): MemoryConversationCapture | null {
  const matches = () => {
    if (!isPresentationCurrent() || chats.get(chat.id) !== chat) return false;
    const boundary = useChatStore.getState().live.getFileRootContext?.();
    return boundary?.root === root && boundary.workspace.kind === "local";
  };
  if (!matches()) return null;
  if (captures >= 256) throw new RangeError("AI memory captures are busy");
  captures += 1;
  let active = true;
  const listeners = new Set<() => void>();
  const subscriptions: (() => void)[] = [];
  const notify = () => {
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        /* Observers cannot retain a retired presentation. */
      }
    }
  };
  const release = () => {
    if (!active) return;
    active = false;
    captures -= 1;
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    notify();
    listeners.clear();
  };
  try {
    const session = captureChatMemoryConversation(chat);
    if (!session || session.cwd !== root)
      throw new Error("The original chat memory context is unavailable");
    const current = () => active && matches() && session.isCurrent();
    const changed = () => {
      if (!current()) release();
      else notify();
    };
    for (const subscribe of [
      useChatStore.subscribe,
      (listener: () => void) => subscribeAiFileRoot(listener, release),
      session.subscribe,
    ]) {
      if (!active) break;
      const unsubscribe = subscribe(changed);
      if (active) subscriptions.push(unsubscribe);
      else unsubscribe();
    }
    if (!current()) {
      release();
      return null;
    }
    const qualified = qualifyMemoryConversation(session, current);
    return Object.freeze({
      conversation: Object.freeze({
        ...qualified,
        subscribe(listener: () => void) {
          if (!current()) return () => undefined;
          if (!listeners.has(listener) && listeners.size >= 256)
            throw new RangeError("AI memory observers are busy");
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      }),
      release,
    });
  } catch (error) {
    release();
    throw error;
  }
}
