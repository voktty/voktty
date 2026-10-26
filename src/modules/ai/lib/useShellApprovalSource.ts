import {
  createContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { observeChatShellTool } from "@/modules/ai/lib/chatFileTools";
import { chats } from "@/modules/ai/store/chatStore";
import type { AiFileContext } from "@/modules/ai/lib/aiFileContext";

export const ApprovalSessionContext = createContext<string | null>(null);

type View = {
  sessionId: string | null;
  chat?: object;
  observation?: ReturnType<typeof observeChatShellTool>;
};

export function useShellApprovalSource(
  sessionId: string | null,
  toolName: string,
  toolCallId: string,
  approvalId: string,
  input: unknown,
) {
  const required = toolName === "bash_run" || toolName === "bash_background";
  const [source, setSource] = useState<AiFileContext | null>(null);
  const current = useRef<View | null>(null);

  useLayoutEffect(() => {
    if (!required) return;
    const chat = sessionId ? chats.get(sessionId) : undefined;
    const view: View = { sessionId, chat };
    current.current = view;
    try {
      if (!chat || (toolName !== "bash_run" && toolName !== "bash_background"))
        throw new Error("Missing original shell source.");
      const observation = observeChatShellTool(
        chat,
        toolCallId,
        toolName,
        input,
        approvalId,
        () => {
          view.observation?.release();
          view.observation = undefined;
          if (current.current === view) setSource(null);
        },
      );
      view.observation = observation;
      setSource({
        directory: observation.target.directory,
        workspace: observation.target.workspace,
      });
    } catch {
      setSource(null);
    }
    return () => {
      if (current.current === view) current.current = null;
      view.observation?.release();
    };
  }, [required, sessionId, toolName, toolCallId, approvalId, input]);

  const canRespond = useCallback((approved: boolean): boolean => {
    const view = current.current;
    if (!view) return false;
    if (
      !view.sessionId ||
      !view.chat ||
      chats.get(view.sessionId) !== view.chat ||
      (approved && !view.observation?.isCurrent())
    ) {
      view.observation?.release();
      view.observation = undefined;
      setSource(null);
      return false;
    }
    return true;
  }, []);

  return { required, source, canRespond };
}
