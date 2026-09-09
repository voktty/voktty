import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  type GitBranchEntry,
  native,
} from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useTranslation } from "@/modules/i18n";
import {
  Delete02Icon,
  FolderTreeIcon,
  GitBranchIcon,
  PlusSignIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
};

export const GitWorktreesView = memo(function GitWorktreesView({
  repoRoot,
  workspaceEnv,
}: Props) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [newSessionId, setNewSessionId] = useState("");
  const [targetRemovePath, setTargetRemovePath] = useState<string | null>(null);

  const loadWorktrees = useCallback(async () => {
    try {
      setLoading(true);
      const res = await native.gitListBranches(repoRoot, workspaceEnv);
      setBranches(res.branches || []);
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to load worktrees"
      );
    } finally {
      setLoading(false);
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    void loadWorktrees();
  }, [loadWorktrees]);

  const worktreeList = useMemo(
    () => branches.filter((b) => b.kind === "worktree" && b.worktreePath),
    [branches]
  );

  const handleCreateWorktree = useCallback(async () => {
    const trimmed = newSessionId.trim();
    if (!trimmed) return;
    try {
      setActionLoading(true);
      await native.gitWorktreeAdd(repoRoot, trimmed, workspaceEnv);
      toast.success(
        t("gitHistory.worktrees.createSuccess")
      );
      setNewSessionId("");
      await loadWorktrees();
    } catch (err) {
      toast.error(
        typeof err === "string"
          ? err
          : (err as Error).message || "Failed to create worktree"
      );
    } finally {
      setActionLoading(false);
    }
  }, [newSessionId, repoRoot, workspaceEnv, loadWorktrees, t]);

  const handleConfirmRemove = useCallback(async () => {
    if (!targetRemovePath) return;
    try {
      setActionLoading(true);
      const outcome = await native.gitWorktreeRemove(
        targetRemovePath,
        true,
        workspaceEnv
      );
      if (outcome.removed) {
        toast.success(
          t("gitHistory.worktrees.removeSuccess")
        );
      } else {
        toast.error(outcome.reason || "Failed to remove worktree");
      }
      setTargetRemovePath(null);
      await loadWorktrees();
    } catch (err) {
      toast.error(
        typeof err === "string"
          ? err
          : (err as Error).message || "Failed to remove worktree"
      );
    } finally {
      setActionLoading(false);
    }
  }, [targetRemovePath, workspaceEnv, loadWorktrees, t]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden select-none text-xs">
      {/* Top action bar */}
      <div className="flex items-center justify-between p-3 border-b border-border/40 gap-2">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <Input
            value={newSessionId}
            onChange={(e) => setNewSessionId(e.target.value)}
            placeholder={t("gitHistory.worktrees.branchPlaceholder")}
            className="h-7 text-xs bg-muted/20 border-border/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateWorktree();
            }}
          />
          <Button
            size="sm"
            onClick={handleCreateWorktree}
            disabled={actionLoading || !newSessionId.trim()}
            className="h-7 px-2.5 gap-1.5 text-xs shrink-0"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} />
            <span>{t("gitHistory.worktrees.add")}</span>
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadWorktrees}
          disabled={loading}
          className="h-7 px-2.5 gap-1.5 text-xs"
        >
          <HugeiconsIcon
            icon={Refresh01Icon}
            size={13}
            className={cn(loading && "animate-spin")}
          />
          <span>{t("gitHistory.worktrees.refresh")}</span>
        </Button>
      </div>

      {/* Main content list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && worktreeList.length === 0 ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>
              {t("gitHistory.worktrees.loading")}
            </span>
          </div>
        ) : worktreeList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground gap-2">
            <HugeiconsIcon
              icon={FolderTreeIcon}
              size={32}
              className="opacity-40"
            />
            <p className="max-w-xs text-xs">
              {t("gitHistory.worktrees.empty")}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
              {t("gitHistory.worktrees.active")}{" "}
              ({worktreeList.length})
            </div>
            {worktreeList.map((wt) => (
              <div
                key={wt.worktreePath}
                className="flex items-center justify-between p-2.5 rounded-md border border-border/40 bg-card/30 hover:bg-card/60 transition-colors"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 font-mono">
                    <HugeiconsIcon
                      icon={GitBranchIcon}
                      size={13}
                      className="text-primary"
                    />
                    <span className="font-semibold text-foreground">
                      {wt.name}
                    </span>
                    {wt.isHead && (
                      <span className="text-[10px] rounded-sm bg-primary/15 px-1.5 py-0.2 font-sans font-semibold text-primary">
                        HEAD
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[11px] text-muted-foreground truncate font-mono"
                    title={wt.worktreePath ?? ""}
                  >
                    {wt.worktreePath}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTargetRemovePath(wt.worktreePath)}
                  disabled={actionLoading}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={Boolean(targetRemovePath)}
        onOpenChange={(open) => !open && setTargetRemovePath(null)}
      >
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("gitHistory.worktrees.removeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs break-all">
              {targetRemovePath}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("gitHistory.worktrees.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("gitHistory.worktrees.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
