import type { WorkspacePlacement } from "@/modules/spaces";
import type { GitHistoryTab, Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { GitHistoryPane, type GitHistorySearchHandle } from "./GitHistoryPane";

type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
  workspaceEnv?: WorkspaceEnv;
};

type Props = {
  tabs: Tab[];
  activeId: number;
  onOpenCommitFile: (input: CommitFileDiffOpenInput) => void;
  onSearchHandle?: (handle: GitHistorySearchHandle | null) => void;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function GitHistoryStack({
  tabs,
  activeId,
  onOpenCommitFile,
  onSearchHandle,
  placements,
}: Props) {
  const histories = tabs.filter(
    (tab): tab is GitHistoryTab => tab.kind === "git-history" && !tab.cold,
  );
  if (histories.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {histories.map((tab) => {
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
              <GitHistoryPane
                repoRoot={tab.repoRoot}
                workspaceEnv={tab.workspaceEnv}
                onOpenCommitFile={onOpenCommitFile}
                onSearchHandle={visible ? onSearchHandle : undefined}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
