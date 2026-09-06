import { Button } from "@/components/ui/button";
import {
  native,
  type GitChangedFile,
  type GitOperationKind,
} from "@/modules/ai/lib/native";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useTranslation } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConflictResolverDialog } from "./ConflictResolverDialog";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

const OPERATION_LABEL_KEY: Record<Exclude<GitOperationKind, "none">, string> = {
  merge: "git.conflicts.inProgressMerge",
  revert: "git.conflicts.inProgressRevert",
  cherryPick: "git.conflicts.inProgressCherryPick",
  rebase: "git.conflicts.inProgressRebase",
};

export function ConflictsPanel({
  repoRoot,
  conflictedFiles,
  onRefresh,
}: {
  repoRoot: string | null;
  conflictedFiles: GitChangedFile[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [operation, setOperation] = useState<GitOperationKind>("none");
  const [busy, setBusy] = useState<"abort" | "continue" | null>(null);
  const [resolvingPath, setResolvingPath] = useState<string | null>(null);

  const loadOperation = useCallback(async () => {
    if (!repoRoot) {
      setOperation("none");
      return;
    }
    try {
      const result = await native.gitOperationStatus(repoRoot, workspaceEnv);
      setOperation(result.kind);
    } catch {
      setOperation("none");
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    void loadOperation();
  }, [loadOperation]);

  if (operation === "none" && conflictedFiles.length === 0) return null;

  const handleAbort = async () => {
    if (!repoRoot || operation === "none" || busy) return;
    setBusy("abort");
    try {
      await native.gitOperationAbort(repoRoot, operation, workspaceEnv);
      toast.success(t("git.conflicts.abortSuccess"));
      await loadOperation();
      onRefresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleContinue = async () => {
    if (!repoRoot || operation === "none" || busy) return;
    if (conflictedFiles.length > 0) {
      toast.error(t("git.conflicts.continueBlocked"));
      return;
    }
    setBusy("continue");
    try {
      await native.gitOperationContinue(repoRoot, operation, workspaceEnv);
      toast.success(t("git.conflicts.continueSuccess"));
      await loadOperation();
      onRefresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="shrink-0 border-b border-border/50 bg-destructive/[0.06]">
      {operation !== "none" ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-destructive">
            <HugeiconsIcon icon={Alert02Icon} size={13} strokeWidth={1.9} />
            <span className="truncate">{t(OPERATION_LABEL_KEY[operation])}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="xs"
              variant="outline"
              className="h-6 cursor-pointer px-2 text-[10.5px]"
              disabled={busy !== null}
              onClick={() => void handleAbort()}
            >
              {busy === "abort" ? t("git.conflicts.aborting") : t("git.conflicts.abort")}
            </Button>
            <Button
              size="xs"
              className="h-6 cursor-pointer px-2 text-[10.5px]"
              disabled={busy !== null || conflictedFiles.length > 0}
              onClick={() => void handleContinue()}
            >
              {busy === "continue" ? t("git.conflicts.continuing") : t("git.conflicts.continue")}
            </Button>
          </div>
        </div>
      ) : null}
      {conflictedFiles.length > 0 ? (
        <div className="px-3 pb-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-destructive/85">
            {t("git.conflicts.title")} ({conflictedFiles.length})
          </div>
          <div className="space-y-0.5">
            {conflictedFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setResolvingPath(file.path)}
                className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px] transition-colors hover:bg-destructive/10"
              >
                <img
                  src={fileIconUrl(basename(file.path))}
                  alt=""
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {repoRoot && resolvingPath ? (
        <ConflictResolverDialog
          open={resolvingPath !== null}
          onOpenChange={(open) => {
            if (!open) setResolvingPath(null);
          }}
          repoRoot={repoRoot}
          path={resolvingPath}
          onResolved={() => {
            setResolvingPath(null);
            onRefresh();
          }}
        />
      ) : null}
    </div>
  );
}
