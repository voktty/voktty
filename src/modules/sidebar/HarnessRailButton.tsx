import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LiveAgent } from "@/modules/harness/lib/liveAgents";
import { useNotchStore } from "@/modules/harness/lib/notchStore";
import { useTranslation } from "@/modules/i18n";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense } from "react";

const HarnessRailMascot = lazy(() => import("./HarnessRailMascot"));

type Props = {
  active: boolean;
  onOpen: () => void;
  onPreload?: () => void;
};

/** The agent the button speaks for: one waiting on approval first, then a running one. */
export function featuredLiveAgent(agents: readonly LiveAgent[]): LiveAgent | null {
  return (
    agents.find((agent) => agent.needsApproval && !agent.done) ??
    agents.find((agent) => !agent.done) ??
    null
  );
}

/**
 * Permanent entry to the Harness at the top of the activity bar. While an
 * agent works it shows that project's pixel mascot instead of the spark.
 */
export function HarnessRailButton({ active, onOpen, onPreload }: Props) {
  const { t } = useTranslation();
  const agent = useNotchStore((state) => featuredLiveAgent(state.liveAgents));
  const label = agent
    ? `${t("harness.agentDevelopment")}: ${agent.title}`
    : t("harness.agentDevelopment");

  const spark = (
    <HugeiconsIcon
      icon={SparklesIcon}
      size={18}
      strokeWidth={active ? 2 : 1.75}
      className="shrink-0 text-violet-400"
    />
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onOpen}
          onMouseEnter={onPreload}
          onFocus={onPreload}
          className="group flex h-10 shrink-0 cursor-pointer items-center justify-center text-content/50 outline-none transition-colors duration-[var(--dur-base)] hover:text-content"
        >
          <span
            className={cn(
              "relative inline-flex size-6.5 items-center justify-center rounded-md transition-colors duration-[var(--dur-base)]",
              "group-hover:bg-content/10 group-focus-visible:ring-2 group-focus-visible:ring-primary/40",
              active && "bg-content/10",
            )}
          >
            {agent ? (
              <Suspense fallback={spark}>
                <HarnessRailMascot
                  cwd={agent.cwd}
                  running={!agent.needsApproval}
                />
              </Suspense>
            ) : (
              spark
            )}
            {agent?.needsApproval ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" />
            ) : null}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
