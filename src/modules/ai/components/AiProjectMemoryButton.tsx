import { useMemo, useSyncExternalStore } from "react";
import type { AiFileRootContext } from "@/modules/ai/lib/aiFileContext";
import { captureAiMemoryConversation } from "@/modules/ai/lib/aiMemoryConversation";
import { subscribeAiFileRoot } from "@/modules/ai/lib/aiRootObservation";
import { useChatActionOwner } from "@/modules/ai/lib/useChatActionOwner";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { ProjectMemoryButton } from "@/modules/workspace-kit/components/ProjectMemoryButton";

const snapshot = () =>
  JSON.stringify(useChatStore.getState().live.getFileRootContext?.() ?? null);

export function AiProjectMemoryButton() {
  const sessionId = useChatStore((state) => state.activeSessionId);
  const captureOwner = useChatActionOwner(sessionId);
  const key = useSyncExternalStore(subscribeAiFileRoot, snapshot);
  const boundary = useMemo(
    () => JSON.parse(key) as AiFileRootContext | null,
    [key],
  );
  return (
    <ProjectMemoryButton
      target={
        boundary
          ? {
              path: boundary.root,
              environment: boundary.workspace,
              source: `ai:${sessionId ?? ""}`,
            }
          : null
      }
      captureConversation={() => {
        if (!sessionId || boundary?.workspace.kind !== "local") return null;
        const owner = captureOwner();
        const chat = owner?.resolve(() => getOrCreateChat(sessionId));
        return owner && chat
          ? captureAiMemoryConversation(chat, boundary.root, owner.isCurrent)
          : null;
      }}
    />
  );
}
