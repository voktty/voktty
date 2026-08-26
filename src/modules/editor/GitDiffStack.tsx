import type { GitReviewQueueConfig } from "@/modules/source-control/GitReviewQueue";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { GitCommitFileDiffTab, GitDiffTab, Tab } from "@/modules/tabs";
import { GitDiffPane } from "./GitDiffPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
  review?: GitReviewQueueConfig;
};

export function GitDiffStack({ tabs, activeId, placements, review }: Props) {
  const diffs = tabs.filter(
    (tab): tab is GitDiffTab | GitCommitFileDiffTab =>
      (tab.kind === "git-diff" || tab.kind === "git-commit-file") && !tab.cold,
  );
  if (diffs.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      {diffs.map((tab) => {
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
              <GitDiffPane
                active={visible}
                source={
                  tab.kind === "git-diff"
                    ? {
                        kind: "working",
                        repoRoot: tab.repoRoot,
                        path: tab.path,
                        mode: tab.mode,
                        originalPath: tab.originalPath,
                        workspaceEnv: tab.workspaceEnv,
                      }
                    : {
                        kind: "commit",
                        repoRoot: tab.repoRoot,
                        sha: tab.sha,
                        path: tab.path,
                        originalPath: tab.originalPath,
                        workspaceEnv: tab.workspaceEnv,
                      }
                }
                chipLabel={
                  tab.kind === "git-commit-file" ? tab.shortSha : undefined
                }
                review={tab.kind === "git-diff" ? review : undefined}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
