import {
  resolveAiFileRootContext,
  type AiFileRootContext,
} from "@/modules/ai/lib/aiFileContext";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import { createMemoryConversations } from "@/modules/workspace-kit/lib/memoryConversations";

type Owner = {
  capture: () => MemoryConversation | null;
  reconcile: (getRoot?: () => AiFileRootContext | null) => void;
  retire: () => void;
};
const owners = new WeakMap<object, Owner>();

function localRoot(value: AiFileRootContext | null): string | null {
  if (value?.workspace.kind !== "local") return null;
  return resolveAiFileRootContext(value.root, value.workspace)?.root ?? null;
}

export function registerChatMemoryOwner(
  chat: object,
  deps: Readonly<{
    isCurrent: () => boolean;
    getRoot: () => AiFileRootContext | null;
    subscribeRoot?: (
      listener: () => void,
      onUnavailable: () => void,
    ) => () => void;
  }>,
): void {
  forgetChatMemoryOwner(chat);
  let retired = false;
  let root: string | null = null;
  let manager: ReturnType<typeof createMemoryConversations> | null = null;
  let conversation: MemoryConversation | null = null;
  let capturing = false;
  let unsubscribe: (() => void) | null = null;
  const retire = () => {
    if (retired) return;
    retired = true;
    const release = unsubscribe;
    unsubscribe = null;
    try {
      release?.();
    } finally {
      manager?.dispose();
    }
  };
  const current = (getRoot = deps.getRoot) => {
    if (retired) return false;
    try {
      if (
        owners.get(chat) === owner &&
        deps.isCurrent() &&
        (root === null || localRoot(getRoot()) === root) &&
        !retired &&
        owners.get(chat) === owner
      )
        return true;
    } catch {
      retire();
      return false;
    }
    retire();
    return false;
  };
  const owner: Owner = {
    capture() {
      if (capturing) return null;
      capturing = true;
      try {
        if (!current()) return null;
        if (conversation?.isCurrent()) return conversation;
        const selected = localRoot(deps.getRoot());
        if (!selected || !current()) return null;
        root = selected;
        if (!current()) return null;
        manager ??= createMemoryConversations();
        conversation = manager.capture(chat, root, root, current);
        if (!unsubscribe && deps.subscribeRoot) {
          try {
            const release = deps.subscribeRoot(() => {
              current();
            }, retire);
            if (retired) release();
            else unsubscribe = release;
          } catch (error) {
            retire();
            throw error;
          }
        }
        if (!current()) return null;
        return conversation;
      } finally {
        capturing = false;
      }
    },
    reconcile(getRoot) {
      if (root !== null) current(getRoot);
    },
    retire,
  };
  owners.set(chat, owner);
}

export function captureChatMemoryConversation(
  chat: object,
): MemoryConversation | null {
  return owners.get(chat)?.capture() ?? null;
}

export function reconcileChatMemoryOwner(
  chat: object,
  getRoot: () => AiFileRootContext | null,
): void {
  owners.get(chat)?.reconcile(getRoot);
}

export function forgetChatMemoryOwner(chat: object): void {
  const owner = owners.get(chat);
  owners.delete(chat);
  owner?.retire();
}
