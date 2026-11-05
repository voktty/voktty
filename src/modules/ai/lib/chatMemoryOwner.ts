import {
  resolveAiFileRootContext,
  type AiFileRootContext,
} from "@/modules/ai/lib/aiFileContext";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import { createMemoryConversations } from "@/modules/workspace-kit/lib/memoryConversations";
import { createAiMemoryDelivery } from "@/modules/ai/lib/aiMemoryDelivery";
import type { AiProjectKitMemorySource } from "@/modules/ai/lib/projectKitMemory";

type Owner = {
  capture: () => MemoryConversation | null;
  reconcile: (getRoot?: () => AiFileRootContext | null) => void;
  retire: () => void;
  source: () => AiProjectKitMemorySource | undefined;
  prepare: (
    assertCurrent: () => void,
  ) => Promise<AiProjectKitMemorySource | undefined>;
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
  let manager: ReturnType<
    typeof createMemoryConversations<AiProjectKitMemorySource>
  > | null = null;
  let conversation: MemoryConversation | null = null;
  let capturing = false;
  let unsubscribe: (() => void) | null = null;
  let releaseDelivery: (() => void) | null = null;
  let requested = false;
  const retire = () => {
    if (retired) return;
    retired = true;
    const release = unsubscribe;
    unsubscribe = null;
    releaseDelivery?.();
    releaseDelivery = null;
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
        manager ??= createMemoryConversations(
          createAiMemoryDelivery,
          "model-response",
        );
        conversation = manager.capture(chat, root, root, current, true);
        releaseDelivery?.();
        const captured = conversation;
        releaseDelivery = captured.subscribe(() => {
          const enabled = captured.delivery?.getSnapshot().enabled === true;
          if (!retired) requested = enabled;
        });
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
    async prepare(assertCurrent) {
      assertCurrent();
      const source = owner.source();
      if (source) return source;
      if (conversation && !conversation.isCurrent()) {
        return undefined;
      }
      const captured = owner.capture();
      if (!captured) return undefined;
      assertCurrent();
      return owner.source();
    },
    source() {
      if (!current()) {
        if (requested) throw new Error("Project memory: cancelled");
        return undefined;
      }
      const source = manager?.turnSource(chat, () => {
        if (!current()) throw new Error("Project memory: cancelled");
      });
      if (source) requested = true;
      return source;
    },
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

export function getChatProjectKitMemory(
  chat: object,
): AiProjectKitMemorySource | undefined {
  const owner = owners.get(chat);
  if (!owner) throw new Error("Project memory: cancelled");
  return owner.source();
}

export async function prepareChatProjectKitMemory(
  chat: object,
  assertCurrent: () => void,
): Promise<AiProjectKitMemorySource | undefined> {
  const owner = owners.get(chat);
  if (!owner) throw new Error("Project memory: cancelled");
  return owner.prepare(assertCurrent);
}
