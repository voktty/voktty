import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { GitBranchEntry, GitRepoInfo, GitStatusSnapshot } from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Download01Icon,
  FolderGitTwoIcon,
  GitBranchIcon,
  Refresh01Icon,
  Search01Icon,
  Tick02Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useMemo, useState } from "react";
import type { GitBranchScope } from "../types";

type Props = {
  repoRoot: string;
  repoInfo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  branches: readonly GitBranchEntry[];
  branchScope: GitBranchScope;
  onChangeBranchScope: (scope: GitBranchScope) => void;
  searchQuery: string;
  onChangeSearchQuery: (query: string) => void;
  onCheckoutBranch: (branchName: string) => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  isFetching?: boolean;
  isPulling?: boolean;
  isPushing?: boolean;
  isRefreshing?: boolean;
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export const GitWorkbenchHeader = memo(function GitWorkbenchHeader({
  repoRoot,
  repoInfo,
  status,
  branches,
  branchScope,
  onChangeBranchScope,
  searchQuery,
  onChangeSearchQuery,
  onCheckoutBranch,
  onFetch,
  onPull,
  onPush,
  onRefresh,
  isFetching,
  isPulling,
  isPushing,
  isRefreshing,
}: Props) {
  const { t } = useTranslation();
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");

  const repoName = useMemo(() => basename(repoRoot), [repoRoot]);
  const currentBranch = repoInfo?.branch ?? status?.branch ?? "HEAD";
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const isDirty = (status?.changedFiles.length ?? 0) > 0;

  const filteredBranches = useMemo(() => {
    if (!branchFilter.trim()) return branches;
    const q = branchFilter.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, branchFilter]);

  return (
    <TooltipProvider delayDuration={150}>
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 bg-card/40 px-3 gap-2 select-none text-xs">
        {/* Left: Repo and Branch Controls */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-foreground/90 shrink-0">
            <HugeiconsIcon icon={FolderGitTwoIcon} size={15} className="text-primary/80" />
            <span className="truncate max-w-[140px]" title={repoRoot}>
              {repoName}
            </span>
          </div>

          <span className="text-border/80">/</span>

          {/* Branch Picker Popover */}
          <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 gap-1.5 bg-background/50 border-border/50 hover:bg-accent/60 font-mono text-xs max-w-[180px]"
              >
                <HugeiconsIcon icon={GitBranchIcon} size={13} className="text-muted-foreground shrink-0" />
                <span className="truncate">{currentBranch}</span>
                {isDirty && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                    title={t("gitHistory.workbench.header.dirty")}
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1.5 text-xs shadow-lg">
              <div className="p-1 mb-1">
                <Input
                  placeholder={t("gitHistory.branches.searchPlaceholder")}
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {filteredBranches.length === 0 ? (
                  <div className="py-3 text-center text-muted-foreground text-xs">
                    {t("gitHistory.workbench.header.noBranches")}
                  </div>
                ) : (
                  filteredBranches.map((b) => {
                    const isSelected = b.isHead || b.name === currentBranch;
                    return (
                      <button
                        key={b.name}
                        type="button"
                        onClick={() => {
                          onCheckoutBranch(b.name);
                          setBranchPopoverOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-2 py-1.5 rounded-sm text-left font-mono transition-colors",
                          isSelected
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-accent text-foreground/80 hover:text-foreground"
                        )}
                      >
                        <span className="truncate flex items-center gap-1.5">
                          <HugeiconsIcon icon={GitBranchIcon} size={12} className="text-muted-foreground" />
                          {b.name}
                        </span>
                        {isSelected && <HugeiconsIcon icon={Tick02Icon} size={12} />}
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Ahead / Behind Pills */}
          {(ahead > 0 || behind > 0) && (
            <div className="flex items-center gap-1 shrink-0 font-mono text-[11px]">
              {ahead > 0 && (
                <span
                  className="flex items-center gap-0.5 rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-semibold"
                  title={t("gitHistory.workbench.header.ahead", { count: ahead })}
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} size={11} strokeWidth={2.5} />
                  {ahead}
                </span>
              )}
              {behind > 0 && (
                <span
                  className="flex items-center gap-0.5 rounded-sm bg-sky-500/10 px-1.5 py-0.5 text-sky-600 dark:text-sky-400 font-semibold"
                  title={t("gitHistory.workbench.header.behind", { count: behind })}
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2.5} />
                  {behind}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Center: Remote Sync Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onFetch}
                disabled={isFetching}
                className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {isFetching ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <HugeiconsIcon icon={Refresh01Icon} size={13} />
                )}
                <span>{t("gitHistory.workbench.header.fetch")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span>{t("gitHistory.workbench.header.fetchTooltip")}</span>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onPull}
                disabled={isPulling}
                className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {isPulling ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <HugeiconsIcon icon={Download01Icon} size={13} />
                )}
                <span>{t("gitHistory.workbench.header.pull")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span>{t("gitHistory.workbench.header.pullTooltip")}</span>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onPush}
                disabled={isPushing}
                className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {isPushing ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <HugeiconsIcon icon={Upload01Icon} size={13} />
                )}
                <span>{t("gitHistory.workbench.header.push")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span>{t("gitHistory.workbench.header.pushTooltip")}</span>
            </TooltipContent>
          </Tooltip>

          <div className="h-4 w-px bg-border/40 mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={13}
                  className={cn(isRefreshing && "animate-spin")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span>{t("gitHistory.workbench.header.refreshTooltip")}</span>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Right: Search & Branch Scope Filter */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Branch Scope Toggle */}
          <div className="flex items-center rounded-md border border-border/50 bg-background/50 p-0.5">
            <button
              type="button"
              onClick={() => onChangeBranchScope("current")}
              className={cn(
                "rounded-sm px-2 py-0.5 text-[11px] font-medium transition-colors",
                branchScope === "current"
                  ? "bg-accent text-accent-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("gitHistory.workbench.header.currentBranch")}
            </button>
            <button
              type="button"
              onClick={() => onChangeBranchScope("all")}
              className={cn(
                "rounded-sm px-2 py-0.5 text-[11px] font-medium transition-colors",
                branchScope === "all"
                  ? "bg-accent text-accent-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("gitHistory.workbench.header.allBranches")}
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-44 md:w-56">
            <HugeiconsIcon
              icon={Search01Icon}
              size={13}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchQuery}
              onChange={(e) => onChangeSearchQuery(e.target.value)}
              placeholder={t("gitHistory.workbench.header.searchPlaceholder")}
              className="h-7 pl-7 pr-6 text-xs bg-background/50 border-border/50"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onChangeSearchQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
              </button>
            )}
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
});
