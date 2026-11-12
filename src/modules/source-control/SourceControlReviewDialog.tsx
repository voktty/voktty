import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitDiffPane } from "@/modules/editor/GitDiffPane";
import { useTranslation } from "@/modules/i18n";
import {
  buildGitReviewEntries,
  sameGitReviewRepository,
} from "@/modules/source-control/lib/reviewQueue";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  repoRoot: string;
  workspaceEnv: WorkspaceEnv;
  sourceControl: SourceControlSummary;
  dirtyPaths: readonly string[];
  onClose: () => void;
};

export function SourceControlReviewDialog({
  repoRoot,
  workspaceEnv,
  sourceControl,
  dirtyPaths,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const entries = sourceControl.status && sameGitReviewRepository(sourceControl.status.repoRoot, repoRoot)
    ? buildGitReviewEntries(sourceControl.status.changedFiles)
    : [];
  const selected =
    entries.find((entry) => entry.path === selectedPath) ?? entries[0];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[85dvh] w-[94vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[94vw]">
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 py-3 pr-12">
          <DialogTitle>{t("sessionReview.reviewChanges")}</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {repoRoot}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {selected ? (
            <GitDiffPane
              key={`${selected.path}\0${selected.unstaged ? "-" : "+"}`}
              active
              source={{
                kind: "working",
                repoRoot,
                path: selected.path,
                mode: selected.unstaged ? "-" : "+",
                originalPath: selected.originalPath,
                workspaceEnv,
              }}
              review={{
                sourceControl,
                dirtyPaths,
                workspaceEnv,
                onOpenDiff: (input) => {
                  if (input.repoRoot === repoRoot) setSelectedPath(input.path);
                },
              }}
            />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground">
              {t("git.noChanges")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
