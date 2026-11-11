import type { Tab } from "@/modules/tabs";
import type { TeamTab } from "@/modules/tabs/lib/useTabs";
import { cn } from "@/lib/utils";
import { TeamBoard } from "./TeamBoard";

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
            <TeamBoard
              projectPath={tab.projectPath}
              spaceId={tab.spaceId}
              onNavigateToTab={onNavigateToTab}
              onNewHarnessTab={onNewHarnessTab}
            />
          </div>
        );
      })}
    </div>
  );
}
