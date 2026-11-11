import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { type AttentionOrigin, unseenAttention, useAgentAttention } from "../lib/attentionStore";

/**
 * Opens the team log. Counts agents on any open host that wait for the
 * owner and, when there are some, opens the log on that host.
 */
export default function AgentFeedButton({
  onOpen,
}: {
  onOpen: (origin: AttentionOrigin | null) => void;
}) {
  const { t } = useTranslation();
  const waiting = useAgentAttention((state) => unseenAttention(state).length);
  const label = waiting
    ? t("agentFeed.openButtonWaiting", { count: waiting })
    : t("agentFeed.openButton");
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        waiting > 0 && "text-amber-600 dark:text-amber-400",
      )}
      onClick={() => {
        const state = useAgentAttention.getState();
        const first = unseenAttention(state)[0];
        onOpen(first ? (state.origins[first.sourceKey] ?? null) : null);
      }}
      title={label}
      aria-label={label}
    >
      <HugeiconsIcon icon={UserGroupIcon} size={14} strokeWidth={1.75} />
      {waiting > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-500 px-0.5 font-semibold text-[8px] text-white leading-none">
          {waiting > 9 ? "9+" : waiting}
        </span>
      ) : null}
    </Button>
  );
}
