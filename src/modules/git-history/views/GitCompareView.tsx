import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  type GitBranchComparison,
  type GitBranchEntry,
  type GitCommitFileChange,
  native,
} from "@/modules/ai/lib/native";
import {
  GitCompareIcon,
  LayoutTwoColumnIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
  currentBranch?: string;
  onOpenFileDiff?: (
    file: GitCommitFileChange,
    base: string,
    compare: string,
    split?: boolean,
  ) => void;
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function formatBranchLabel(b: GitBranchEntry): string {
  return b.isHead ? `${b.name} (HEAD)` : b.name;
}

export const GitCompareView = memo(function GitCompareView({
  repoRoot,
  workspaceEnv,
  onOpenFileDiff,
}: Props) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [compareBranch, setCompareBranch] = useState<string>("");
  const [comparison, setComparison] = useState<GitBranchComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparingLoading, setComparingLoading] = useState(false);

  const loadBranches = useCallback(async () => {
    try {
      setLoading(true);
      const res = await native.gitListBranches(repoRoot, workspaceEnv);
      const list = res.branches || [];
      setBranches(list);
      if (list.length > 0) {
        const head = list.find((b) => b.isHead) || list[0];
        setBaseBranch(head.name);
        const other = list.find((b) => b.name !== head.name) || head;
        setCompareBranch(other.name);
      }
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to load branches"
      );
    } finally {
      setLoading(false);
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  const handleCompare = useCallback(async () => {
    if (!baseBranch || !compareBranch) return;
    try {
      setComparingLoading(true);
      const res = await native.gitCompareBranches(
        repoRoot,
        baseBranch,
        compareBranch,
        workspaceEnv
      );
      setComparison(res);
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to compare branches"
      );
    } finally {
      setComparingLoading(false);
    }
  }, [repoRoot, baseBranch, compareBranch, workspaceEnv]);

  const handleSwap = useCallback(() => {
    setBaseBranch(compareBranch);
    setCompareBranch(baseBranch);
  }, [baseBranch, compareBranch]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden select-none text-xs">
      {/* Selection Bar */}
      <div className="flex items-center justify-between p-3 border-b border-border/40 gap-2 font-mono">
        <div className="flex items-center gap-2 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-sans">{t("gitHistory.compare.base")}:</span>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="h-7 rounded-md border border-border/50 bg-background px-2 text-xs"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {formatBranchLabel(b)}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSwap}
            className="h-7 w-7 p-0 text-muted-foreground"
            title={t("gitHistory.compare.swap")}
          >
            <HugeiconsIcon icon={GitCompareIcon} size={14} />
          </Button>

          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-sans">{t("gitHistory.compare.compare")}:</span>
            <select
              value={compareBranch}
              onChange={(e) => setCompareBranch(e.target.value)}
              className="h-7 rounded-md border border-border/50 bg-background px-2 text-xs"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {formatBranchLabel(b)}
                </option>
              ))}
            </select>
          </div>

          <Button
            size="sm"
            onClick={handleCompare}
            disabled={comparingLoading || !baseBranch || !compareBranch}
            className="h-7 px-3 gap-1.5 font-sans"
          >
            {comparingLoading ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <HugeiconsIcon icon={GitCompareIcon} size={13} />
            )}
            <span>{t("gitHistory.compare.btnCompare")}</span>
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadBranches}
          disabled={loading}
          className="h-7 px-2.5 gap-1.5 font-sans"
        >
          <HugeiconsIcon
            icon={Refresh01Icon}
            size={13}
            className={cn(loading && "animate-spin")}
          />
          <span>{t("gitHistory.compare.refresh")}</span>
        </Button>
      </div>

      {/* Comparison Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!comparison && !comparingLoading ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground gap-2">
            <HugeiconsIcon icon={GitCompareIcon} size={32} className="opacity-40" />
            <p>{t("gitHistory.compare.hint")}</p>
          </div>
        ) : comparingLoading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>{t("gitHistory.compare.loading")}</span>
          </div>
        ) : comparison && (
          <div className="space-y-4">
            {/* Commits Ahead / Behind Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-md border border-border/40 bg-card/30 space-y-2">
                <div className="font-semibold text-emerald-500 flex items-center justify-between">
                  <span>{t("gitHistory.compare.commitsAhead")} ({comparison.ahead.length})</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("gitHistory.compare.inCompare", { compare: compareBranch, base: baseBranch })}
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1">
                  {comparison.ahead.length === 0 ? (
                    <div className="text-muted-foreground py-2">
                      {t("gitHistory.compare.noAheadCommits")}
                    </div>
                  ) : (
                    comparison.ahead.map((c) => (
                      <div
                        key={c.sha}
                        className="px-2 py-1 rounded bg-muted/10 font-mono text-[11px] truncate"
                        title={c.subject}
                      >
                        <span className="text-primary mr-1.5">
                          {c.sha.slice(0, 7)}
                        </span>
                        <span>{c.subject}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-3 rounded-md border border-border/40 bg-card/30 space-y-2">
                <div className="font-semibold text-sky-500 flex items-center justify-between">
                  <span>{t("gitHistory.compare.commitsBehind")} ({comparison.behind.length})</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("gitHistory.compare.inBase", { base: baseBranch, compare: compareBranch })}
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1">
                  {comparison.behind.length === 0 ? (
                    <div className="text-muted-foreground py-2">
                      {t("gitHistory.compare.noBehindCommits")}
                    </div>
                  ) : (
                    comparison.behind.map((c) => (
                      <div
                        key={c.sha}
                        className="px-2 py-1 rounded bg-muted/10 font-mono text-[11px] truncate"
                        title={c.subject}
                      >
                        <span className="text-primary mr-1.5">
                          {c.sha.slice(0, 7)}
                        </span>
                        <span>{c.subject}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* File Changes */}
            <div className="space-y-1.5">
              <div className="font-semibold text-muted-foreground uppercase tracking-wider px-1">
                {t("gitHistory.compare.changedFiles")} ({comparison.files.length})
              </div>

              <div className="space-y-1">
                {comparison.files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-md border border-border/30 bg-card/20 hover:bg-card/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 font-mono">
                      <img
                        src={fileIconUrl(basename(file.path))}
                        alt=""
                        className="h-4 w-4 rounded-sm shrink-0"
                      />
                      <span className="truncate" title={file.path}>
                        {file.path}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 font-mono text-[11px]">
                        {file.added > 0 && (
                          <span className="text-emerald-500">+{file.added}</span>
                        )}
                        {file.removed > 0 && (
                          <span className="text-rose-500">-{file.removed}</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          onOpenFileDiff?.(file, baseBranch, compareBranch)
                        }
                        className="rounded px-2 py-0.5 bg-muted/20 hover:bg-accent text-[11px]"
                      >
                        {t("gitHistory.compare.diff")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenFileDiff?.(
                            file,
                            baseBranch,
                            compareBranch,
                            true,
                          )
                        }
                        title={t("gitHistory.contextMenu.openSplitDiff")}
                        className="rounded p-1 bg-muted/20 hover:bg-accent text-[11px]"
                      >
                        <HugeiconsIcon icon={LayoutTwoColumnIcon} size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
