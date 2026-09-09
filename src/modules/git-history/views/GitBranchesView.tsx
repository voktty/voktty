import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  type GitBranchEntry,
  native,
} from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  GitBranchIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
  currentBranch?: string;
  onCheckoutBranch: (branch: string) => void;
};

export const GitBranchesView = memo(function GitBranchesView({
  repoRoot,
  workspaceEnv,
  currentBranch,
  onCheckoutBranch,
}: Props) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const loadBranches = useCallback(async () => {
    try {
      setLoading(true);
      const res = await native.gitListBranches(repoRoot, workspaceEnv);
      setBranches(res.branches || []);
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

  const filtered = useMemo(() => {
    if (!search.trim()) return branches;
    const q = search.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, search]);

  const localBranches = useMemo(
    () => filtered.filter((b) => b.kind === "local"),
    [filtered]
  );
  const worktreeBranches = useMemo(
    () => filtered.filter((b) => b.kind === "worktree"),
    [filtered]
  );

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden select-none text-xs">
      <div className="flex items-center justify-between p-3 border-b border-border/40 gap-2">
        <div className="relative flex-1 max-w-xs">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("gitHistory.branches.searchPlaceholder")}
            className="h-7 pl-7 text-xs bg-muted/20 border-border/40"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadBranches}
          disabled={loading}
          className="h-7 px-2.5 gap-1.5 text-xs"
        >
          <HugeiconsIcon
            icon={Refresh01Icon}
            size={13}
            className={cn(loading && "animate-spin")}
          />
          <span>{t("gitHistory.branches.refresh")}</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading && branches.length === 0 ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>{t("gitHistory.branches.loading")}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t("gitHistory.branches.noMatches")}
          </div>
        ) : (
          <>
            {/* Local Branches */}
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                {t("gitHistory.branches.local")} ({localBranches.length})
              </div>
              <div className="space-y-0.5">
                {localBranches.map((b) => {
                  const isHead = b.isHead || b.name === currentBranch;
                  return (
                    <div
                      key={b.name}
                      className={cn(
                        "flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors",
                        isHead
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-accent text-foreground/80 hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0 font-mono">
                        <HugeiconsIcon
                          icon={GitBranchIcon}
                          size={14}
                          className={isHead ? "text-primary" : "text-muted-foreground"}
                        />
                        <span className="truncate">{b.name}</span>
                        {isHead && (
                          <span className="text-[10px] rounded-sm bg-primary/15 px-1.5 py-0.2 font-sans font-semibold">
                            HEAD
                          </span>
                        )}
                      </div>
                      {!isHead && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onCheckoutBranch(b.name)}
                          className="h-6 px-2 text-[11px]"
                        >
                          {t("gitHistory.branches.checkout")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Worktree Branches */}
            {worktreeBranches.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                  {t("gitHistory.branches.worktree")} ({worktreeBranches.length})
                </div>
                <div className="space-y-0.5">
                  {worktreeBranches.map((b) => (
                    <div
                      key={b.name}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-accent text-foreground/80 font-mono"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <HugeiconsIcon icon={GitBranchIcon} size={14} className="text-sky-500" />
                        <span className="truncate">{b.name}</span>
                        {b.worktreePath && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-xs font-sans">
                            ({b.worktreePath})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
