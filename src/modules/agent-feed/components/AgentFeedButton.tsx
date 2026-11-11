import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { AttentionItem } from "../lib/attention";
import {
  type AttentionOrigin,
  hostKeyOf,
  unseenAttention,
  useAgentAttention,
} from "../lib/attentionStore";

/**
 * The team entry. Lights up while agents work on the active window's host
 * (local or that tab's SSH server) and turns amber with a count when an
 * agent on any open host waits for the owner. Opens the team of the
 * waiting agent's project, or of the project on screen.
 */
export default function AgentFeedButton({
  onOpen,
  env,
}: {
  onOpen: (origin: AttentionOrigin | null, item: AttentionItem | null) => void;
  env?: WorkspaceEnv;
}) {
  const { t } = useTranslation();
  const hostKey = hostKeyOf(env);
  const waiting = useAgentAttention((state) => unseenAttention(state).length);
  const busy = useAgentAttention((state) =>
    hostKey
      ? (state.agents[hostKey] ?? []).filter((agent) => agent.status === "busy").length
      : 0,
  );
  const live = useAgentAttention((state) =>
    hostKey ? (state.agents[hostKey] ?? []).length : 0,
  );
  const label = waiting
    ? t("agentFeed.openButtonWaiting", { count: waiting })
    : busy
      ? t("agentFeed.openButtonBusy", { count: busy })
      : live
        ? t("agentFeed.openButtonLive", { count: live })
        : t("agentFeed.openButton");
  return (
    <Button
      variant="ghost"
      size="icon"
      data-state={waiting ? "waiting" : busy ? "busy" : live ? "live" : "idle"}
      className={cn(
        "relative size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        waiting > 0
          ? "text-amber-600 dark:text-amber-400"
          : busy > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : live > 0 && "text-foreground/80",
      )}
      onClick={() => {
        const state = useAgentAttention.getState();
        const first = unseenAttention(state)[0];
        onOpen(first ? (state.origins[first.sourceKey] ?? null) : null, first ?? null);
      }}
      title={label}
      aria-label={label}
    >
      <HugeiconsIcon
        icon={UserGroupIcon}
        size={14}
        strokeWidth={1.75}
        className={cn(busy > 0 && waiting === 0 && "motion-safe:animate-pulse")}
      />
      {waiting > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-500 px-0.5 font-semibold text-[8px] text-white leading-none">
          {waiting > 9 ? "9+" : waiting}
        </span>
      ) : null}
    </Button>
  );
}
