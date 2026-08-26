import { useTranslation } from "@/modules/i18n";
import type { ReactNode } from "react";
import { AiChatBody } from "./AiMiniWindow";
import { AiStatusBarControls } from "./AiStatusBarControls";
import { PlanDiffReview } from "./PlanDiffReview";
import { useChatStore } from "../store/chatStore";

type Props = {
  composer: ReactNode;
  onClose: () => void;
};

const noop = () => {};
const noopPointer = (_event: React.PointerEvent) => {};

export function AiSidebarPanel({ composer, onClose }: Props) {
  const { t } = useTranslation();
  const sessionId = useChatStore((s) => s.activeSessionId);

  return (
    <aside
      aria-label={t("ai.openAgent")}
      data-ai-chat-drop="true"
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-card text-[12px]"
    >
      {sessionId ? (
        <AiChatBody
          sessionId={sessionId}
          onClose={onClose}
          onExpand={noop}
          onHeaderPointerDown={noopPointer}
          sidebar
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[11px] text-muted-foreground">
          {t("ai.loadingSessions")}
        </div>
      )}
      {composer}
      <div className="shrink-0 overflow-x-auto border-t border-border/60 bg-foreground/[0.02] px-2 py-1">
        <AiStatusBarControls hidePanelClose compact />
      </div>
      <PlanDiffReview />
    </aside>
  );
}
