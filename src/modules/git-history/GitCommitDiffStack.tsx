import type { WorkspacePlacement } from "@/modules/spaces";
import type { GitCommitDiffTab, Tab } from "@/modules/tabs";
import { GitCommitDiffPane } from "./GitCommitDiffPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function GitCommitDiffStack({ tabs, activeId, placements }: Props) {
  const commits = tabs.filter(
    (tab): tab is GitCommitDiffTab => tab.kind === "git-commit" && !tab.cold,
  );
  if (commits.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      {commits.map((tab) => {
        const placement = placements?.get(tab.id);
        const visible = placements
          ? placement !== undefined
          : tab.id === activeId;
        return (
          <div
            key={tab.id}
            data-space-slot={placement?.slotId}
            data-space-tab={tab.id}
            className="absolute"
            style={
              placement
                ? {
                    left: `${placement.rect.x * 100}%`,
                    top: `${placement.rect.y * 100}%`,
                    width: `${placement.rect.width * 100}%`,
                    height: `${placement.rect.height * 100}%`,
                    pointerEvents: "auto",
                  }
                : { inset: 0, pointerEvents: visible ? "auto" : "none" }
            }
            aria-hidden={!visible}
          >
            <div
              className={
                visible
                  ? "h-full w-full"
                  : "invisible pointer-events-none h-full w-full"
              }
            >
              <GitCommitDiffPane
                repoRoot={tab.repoRoot}
                sha={tab.sha}
                shortSha={tab.shortSha}
                subject={tab.subject}
                workspaceEnv={tab.workspaceEnv}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
