import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { GitLogEntry } from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import { useBranchComparison } from "@/modules/source-control/useBranchComparison";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function BranchCompareDialog({
  open,
  onOpenChange,
  repoRoot,
  currentBranch,
  contextKey = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string | null;
  currentBranch: string | null;
  contextKey?: string;
}) {
  const { t } = useTranslation();
  const {
    branches,
    base,
    compare,
    state,
    setBase,
    setCompare,
    setOpen,
    listing,
    listError,
    retryBranches,
    retryComparison,
  } = useBranchComparison({
    open,
    onOpenChange,
    repoRoot,
    currentBranch,
    contextKey,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-2xl bg-card/95 backdrop-blur-md border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} className="text-primary" />
            {t("git.compare.title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("git.compare.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {listing ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {t("git.loadingBranches")}
          </div>
        ) : listError ? (
          <div role="alert" className="py-2 text-xs text-destructive">
            {listError}
            <button
              type="button"
              className="ml-2 cursor-pointer underline"
              onClick={retryBranches}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-2 py-2 text-xs">
          <Select value={base} onValueChange={setBase}>
            <SelectTrigger size="sm" className="h-8 flex-1 text-[12px]">
              <SelectValue placeholder={t("git.compare.selectBase")} />
            </SelectTrigger>
            <SelectContent>
              {branches.map((name) => (
                <SelectItem key={name} value={name} className="text-[12px]">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={14}
            className="shrink-0 text-muted-foreground"
          />
          <Select value={compare} onValueChange={setCompare}>
            <SelectTrigger size="sm" className="h-8 flex-1 text-[12px]">
              <SelectValue placeholder={t("git.compare.selectCompare")} />
            </SelectTrigger>
            <SelectContent>
              {branches.map((name) => (
                <SelectItem key={name} value={name} className="text-[12px]">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {state.status === "idle" ? (
            <div className="px-1 py-6 text-center text-[12px] text-muted-foreground">
              {t("git.compare.pickBothHint")}
            </div>
          ) : state.status === "loading" ? (
            <div className="flex items-center gap-2 px-1 py-6 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t("common.loading")}
            </div>
          ) : state.status === "error" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12px] leading-relaxed text-destructive">
              {state.message}
              <button
                type="button"
                className="ml-2 cursor-pointer underline"
                onClick={retryComparison}
              >
                {t("common.retry")}
              </button>
            </div>
          ) : (
            <ScrollArea className="h-full max-h-[60vh] pr-3">
              <div className="space-y-4 text-[12px]">
                <CommitSection
                  title={t("git.compare.aheadTitle", {
                    compare,
                    count: state.data.ahead.length,
                  })}
                  entries={state.data.ahead}
                  emptyLabel={t("git.compare.aheadEmpty")}
                />
                <CommitSection
                  title={t("git.compare.behindTitle", {
                    base,
                    count: state.data.behind.length,
                  })}
                  entries={state.data.behind}
                  emptyLabel={t("git.compare.behindEmpty")}
                />
                <div>
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {t("git.compare.filesChanged", {
                      count: state.data.files.length,
                    })}
                  </div>
                  {state.data.files.length === 0 ? (
                    <div className="text-muted-foreground">
                      {t("git.compare.noFileChanges")}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {state.data.files.map((file) => (
                        <div
                          key={file.path}
                          className="flex items-center gap-2 rounded px-1.5 py-1 font-mono"
                        >
                          <span className="w-4 shrink-0 text-center text-muted-foreground">
                            {file.status}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {file.path}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommitSection({
  title,
  entries,
  emptyLabel,
}: {
  title: string;
  entries: GitLogEntry[];
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </div>
      {entries.length === 0 ? (
        <div className="text-muted-foreground">{emptyLabel}</div>
      ) : (
        <div className="space-y-0.5">
          {entries.map((entry) => (
            <div
              key={entry.sha}
              className="flex items-center justify-between gap-2 px-1.5 py-1 hover:bg-muted/40 rounded transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                <span className="shrink-0 rounded bg-muted/65 px-1 py-0.5 font-mono text-[9.5px] leading-none text-muted-foreground">
                  {entry.shortSha}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.subject}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] tabular-nums">
                {entry.insertions > 0 && (
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    +{entry.insertions}
                  </span>
                )}
                {entry.deletions > 0 && (
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    −{entry.deletions}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
