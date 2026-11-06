import { useMemo, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useComposer } from "@/modules/ai/lib/composer";
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
  const composer = useComposer();
  const key = useSyncExternalStore(subscribeAiFileRoot, snapshot);
  const boundary = useMemo(
    () => JSON.parse(key) as AiFileRootContext | null,
    [key],
  );
  return (
    <ProjectMemoryButton
      observe
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
      captureInitialMemory={() => {
        const owner = captureOwner();
        if (
          !owner ||
          !boundary ||
          boundary.workspace.kind !== "local" ||
          composer.isBusy
        )
          return null;
        let active = true;
        let stop = () => {};
        const current = () => {
          if (!active) return false;
          try {
            if (!owner.isCurrent() || snapshot() !== key) active = false;
          } catch {
            active = false;
          }
          return active;
        };
        const release = () => {
          active = false;
          stop();
        };
        stop = subscribeAiFileRoot(() => {
          if (!current()) release();
        }, release);
        if (!current()) {
          release();
          return null;
        }
        return {
          release,
          prepare(prompt) {
            if (!current()) return false;
            let inserted = false;
            flushSync(() =>
              composer.setValue((previous) => {
                if (!current()) return previous;
                inserted = true;
                return previous ? `${previous}\n\n${prompt}` : prompt;
              }),
            );
            return inserted && current();
          },
        };
      }}
    />
  );
}
