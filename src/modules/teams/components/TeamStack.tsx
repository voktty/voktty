import { lazy, Suspense, useEffect, useState } from "react";
import type { Tab } from "@/modules/tabs";
import type { TeamTab } from "@/modules/tabs/lib/useTabs";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import type { HostAgent } from "@/modules/agent-feed/lib/attention";
import {
  hostKeyOfProject,
  type TeamView,
  useAgentAttention,
} from "@/modules/agent-feed/lib/attentionStore";
import { TeamBoard } from "./TeamBoard";

// The log loads with its first opening, like the floating one did.
const LazyAgentFeedPanel = lazy(
  () => import("@/modules/agent-feed/components/AgentFeedPanel"),
);

type Props = {
  tabs: Tab[];
  activeId: number;
  onNavigateToTab?: (tabId: number) => void;
  onNewHarnessTab?: (spaceId?: string, cwd?: string, sessionId?: string) => number;
};

export function TeamStack({
  tabs,
  activeId,
  onNavigateToTab,
  onNewHarnessTab,
}: Props) {
  const teamTabs = tabs.filter(
    (tab): tab is TeamTab => tab.kind === "team" && !tab.cold,
  );

  if (teamTabs.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      {teamTabs.map((tab) => {
        const isVisible = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 h-full w-full",
              !isVisible && "invisible pointer-events-none",
            )}
            aria-hidden={!isVisible}
          >
            <TeamWorkspace
              tab={tab}
              visible={isVisible}
              onNavigateToTab={onNavigateToTab}
              onNewHarnessTab={onNewHarnessTab}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Folder an agent's cwd belongs to, relative to the team project. */
function insideProject(cwd: string | null, projectPath: string): boolean {
  if (!cwd) return false;
  const root = (projectPath.match(/^remote:\/\/[^/]+(\/.*)$/)?.[1] ?? projectPath)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  const dir = cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  // Sibling worktrees (`<project>-nodo-273`) belong to the team too.
  return dir === root || dir.startsWith(`${root}/`) || dir.startsWith(`${root}-`);
}

const NO_AGENTS: HostAgent[] = [];

/**
 * One team, two views: the board the team runs from and the log of what
 * its agents say. Agents started outside the board (tmux, a terminal) show
 * on the board as external and read-only.
 */
function TeamWorkspace({
  tab,
  visible,
  onNavigateToTab,
  onNewHarnessTab,
}: {
  tab: TeamTab;
  visible: boolean;
  onNavigateToTab?: (tabId: number) => void;
  onNewHarnessTab?: Props["onNewHarnessTab"];
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<TeamView>("board");
  const [logOpened, setLogOpened] = useState(false);
  const requested = useAgentAttention((state) => state.requestedView);
  const hostKey = hostKeyOfProject(tab.projectPath);
  const hostAgents = useAgentAttention((state) => state.agents[hostKey] ?? NO_AGENTS);
  const external = hostAgents.filter((agent) => insideProject(agent.cwd, tab.projectPath));

  // The status bar and the agent notifications ask for a view on opening.
  useEffect(() => {
    if (!visible || !requested) return;
    setView(requested);
    useAgentAttention.getState().requestView(null);
  }, [visible, requested]);
  useEffect(() => {
    if (view === "communications") setLogOpened(true);
  }, [view]);

  return (
    <div className="flex h-full w-full flex-col">
      <div role="tablist" className="flex shrink-0 items-center gap-1 border-border/60 border-b px-4 pt-2">
        {(["board", "communications"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={view === option}
            onClick={() => setView(option)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 font-medium text-sm",
              view === option
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(option === "board" ? "teams.viewBoard" : "teams.viewCommunications")}
          </button>
        ))}
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", view !== "board" && "hidden")}>
        {external.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-border/40 border-b px-6 py-2 text-xs">
            <span className="text-muted-foreground">{t("teams.externalAgents")}</span>
            {external.map((agent) => (
              <button
                key={agent.sessionId}
                type="button"
                onClick={() => setView("communications")}
                title={agent.tmux ?? undefined}
                className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-0.5 hover:bg-accent"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    agent.status === "busy" ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/50",
                  )}
                />
                <span className="font-medium">{agent.name}</span>
                <span className="text-muted-foreground">
                  {t(agent.status === "busy" ? "teams.externalBusy" : "teams.externalIdle")}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <TeamBoard
            projectPath={tab.projectPath}
            spaceId={tab.spaceId}
            onNavigateToTab={onNavigateToTab}
            onNewHarnessTab={onNewHarnessTab}
          />
        </div>
      </div>
      {logOpened ? (
        <div className={cn("flex min-h-0 flex-1 flex-col", view !== "communications" && "hidden")}>
          <Suspense fallback={null}>
            <LazyAgentFeedPanel
              projectPath={tab.projectPath}
              active={visible && view === "communications"}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
