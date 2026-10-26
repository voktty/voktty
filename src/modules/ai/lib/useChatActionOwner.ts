import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Chat, UIMessage } from "@ai-sdk/react";
import { createChatActionOwner } from "@/modules/ai/lib/chatActionOwner";
import { getChat, useChatStore } from "@/modules/ai/store/chatStore";

type Owner = ReturnType<typeof createChatActionOwner<Chat<UIMessage>>>;

export function useChatActionOwner(sessionId: string | null) {
  const [generation, setGeneration] = useState(0);
  const binding = useMemo(
    () => ({ sessionId, generation }),
    [sessionId, generation],
  );
  const committed = useRef<{
    binding: typeof binding;
    owner: Owner;
    rearm: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    if (!sessionId) return;
    const owner = createChatActionOwner({
      isCurrent: () => {
        const state = useChatStore.getState();
        return (
          state.activeSessionId === sessionId &&
          state.sessions.some((s) => s.id === sessionId)
        );
      },
      getChat: () => getChat(sessionId),
    });
    let retired = false;
    const rearm = () => {
      if (retired) return;
      retired = true;
      setGeneration((value) => value + 1);
    };
    const view = { binding, owner, rearm };
    committed.current = view;
    const unsubscribe = useChatStore.subscribe(() => {
      if (!owner.isCurrent()) rearm();
    });
    return () => {
      owner.retire();
      unsubscribe();
      if (committed.current === view) committed.current = null;
    };
  }, [binding, sessionId]);

  return useCallback(() => {
    const view = committed.current;
    if (view?.binding !== binding) return null;
    if (view.owner.isCurrent()) return view.owner;
    view.rearm();
    return null;
  }, [binding]);
}
