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
import {
  native,
  type GitBranchComparison,
  type GitLogEntry,
} from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

type CompareState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: GitBranchComparison };

export function BranchCompareDialog({
  open,
  onOpenChange,
  repoRoot,
  currentBranch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string | null;
  currentBranch: string | null;
}) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [compare, setCompare] = useState("");
  const [state, setState] = useState<CompareState>({ status: "idle" });

  useEffect(() => {
    if (!open || !repoRoot) return;
    setBase(currentBranch ?? "");
    setCompare("");
    setState({ status: "idle" });
    void native
      .gitListBranches(repoRoot, workspaceEnv)
      .then((result) => {
        setBranches(
          result.branches
            .filter((b) => b.kind === "local")
            .map((b) => b.name),
        );
      })
      .catch(() => setBranches([]));
  }, [open, repoRoot, currentBranch, workspaceEnv]);

  const runCompare = useCallback(
    async (baseRef: string, compareRef: string) => {
      if (!repoRoot || !baseRef || !compareRef || baseRef === compareRef) {
        return;
      }
      setState({ status: "loading" });
      try {
        const data = await native.gitCompareBranches(
          repoRoot,
          baseRef,
          compareRef,
          workspaceEnv,
        );
        setState({ status: "ready", data });
      } catch (err) {
        setState({ status: "error", message: errorMessage(err) });
      }
    },
    [repoRoot, workspaceEnv],
  );

  useEffect(() => {
    if (base && compare && base !== compare) void runCompare(base, compare);
  }, [base, compare, runCompare]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <div key={entry.sha} className="flex items-center gap-2 px-1.5 py-1">
              <span className="shrink-0 rounded bg-muted/65 px-1 py-0.5 font-mono text-[9.5px] leading-none text-muted-foreground">
                {entry.shortSha}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.subject}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
