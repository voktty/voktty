import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { native } from "@/modules/ai/lib/native";
import { joinPath } from "@/modules/explorer/lib/useFileTree";
import { useTranslation } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  File02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  applyConflictResolutions,
  parseConflictMarkers,
  type ConflictResolution,
  type ParsedConflicts,
} from "./lib/conflictMarkers";

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unresolvable" }
  | { status: "ready"; parsed: ParsedConflicts };

export function ConflictResolverDialog({
  open,
  onOpenChange,
  repoRoot,
  path,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string;
  path: string;
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [resolutions, setResolutions] = useState<
    Map<number, ConflictResolution>
  >(new Map());
  const [saving, setSaving] = useState(false);

  const absolutePath = useMemo(
    () => joinPath(repoRoot, path),
    [repoRoot, path],
  );

  useEffect(() => {
    if (!open) return;
    setState({ status: "loading" });
    setResolutions(new Map());
    let cancelled = false;
    void native
      .readFile(absolutePath)
      .then((result) => {
        if (cancelled) return;
        if (result.kind !== "text") {
          setState({ status: "unresolvable" });
          return;
        }
        const parsed = parseConflictMarkers(result.content);
        if (parsed.hunks.length === 0) {
          setState({ status: "unresolvable" });
          return;
        }
        setState({ status: "ready", parsed });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, absolutePath]);

  const setResolution = useCallback(
    (hunkIndex: number, resolution: ConflictResolution) => {
      setResolutions((prev) => {
        const next = new Map(prev);
        next.set(hunkIndex, resolution);
        return next;
      });
    },
    [],
  );

  const hunkCount = state.status === "ready" ? state.parsed.hunks.length : 0;
  const allResolved = hunkCount > 0 && resolutions.size === hunkCount;

  const handleSave = useCallback(async () => {
    if (state.status !== "ready" || !allResolved || saving) return;
    setSaving(true);
    try {
      const finalText = applyConflictResolutions(state.parsed, resolutions);
      await native.writeFile(absolutePath, finalText);
      await native.gitStage(repoRoot, [path], workspaceEnv);
      toast.success(t("git.conflicts.resolvedSuccess", { path }));
      onOpenChange(false);
      onResolved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [
    absolutePath,
    allResolved,
    onOpenChange,
    onResolved,
    path,
    repoRoot,
    resolutions,
    saving,
    state,
    t,
    workspaceEnv,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden sm:max-w-3xl bg-card/95 backdrop-blur-md border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={File02Icon} size={18} className="text-primary" />
            <span className="truncate font-mono text-sm">{path}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("git.conflicts.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden py-2">
          {state.status === "loading" ? (
            <div className="flex items-center gap-2 px-1 py-6 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t("common.loading")}
            </div>
          ) : state.status === "error" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12px] leading-relaxed text-destructive">
              {state.message}
            </div>
          ) : state.status === "unresolvable" ? (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[12px] leading-relaxed text-muted-foreground">
              {t("git.conflicts.unresolvable")}
            </div>
          ) : (
            <ScrollArea className="h-full max-h-[55vh] pr-3">
              <div className="space-y-4">
                {state.parsed.hunks.map((hunk, index) => {
                  const resolution = resolutions.get(index);
                  return (
                    <div
                      key={hunk.startLine}
                      className="overflow-hidden rounded-lg border border-border/60"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/30 px-2.5 py-1.5">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          {t("git.conflicts.hunkLabel", { n: index + 1 })}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="xs"
                            variant={resolution === "ours" ? "default" : "outline"}
                            className="h-6 cursor-pointer gap-1 px-1.5 text-[10.5px]"
                            onClick={() => setResolution(index, "ours")}
                          >
                            <HugeiconsIcon icon={ArrowLeft01Icon} size={11} strokeWidth={2} />
                            {t("git.conflicts.acceptOurs")}
                          </Button>
                          <Button
                            size="xs"
                            variant={resolution === "theirs" ? "default" : "outline"}
                            className="h-6 cursor-pointer gap-1 px-1.5 text-[10.5px]"
                            onClick={() => setResolution(index, "theirs")}
                          >
                            <HugeiconsIcon icon={ArrowRight01Icon} size={11} strokeWidth={2} />
                            {t("git.conflicts.acceptTheirs")}
                          </Button>
                          <Button
                            size="xs"
                            variant={resolution === "both" ? "default" : "outline"}
                            className="h-6 cursor-pointer gap-1 px-1.5 text-[10.5px]"
                            onClick={() => setResolution(index, "both")}
                          >
                            <HugeiconsIcon icon={CheckmarkCircle01Icon} size={11} strokeWidth={2} />
                            {t("git.conflicts.acceptBoth")}
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-border/50 text-[11px]">
                        <div>
                          <div className="bg-primary/5 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                            {hunk.oursLabel || t("git.conflicts.ours")}
                          </div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all px-2 py-1.5 font-mono">
                            {hunk.oursLines.join("\n") || t("git.conflicts.empty")}
                          </pre>
                        </div>
                        <div>
                          <div className="bg-accent/30 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                            {hunk.theirsLabel || t("git.conflicts.theirs")}
                          </div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all px-2 py-1.5 font-mono">
                            {hunk.theirsLines.join("\n") || t("git.conflicts.empty")}
                          </pre>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-xs"
          >
            {t("common.cancel")}
          </Button>
          {state.status === "ready" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={!allResolved || saving}
              className="gap-2 text-xs font-medium"
            >
              {saving ? <Spinner className="size-3.5" /> : null}
              {saving
                ? t("common.loading")
                : allResolved
                  ? t("git.conflicts.markResolved")
                  : t("git.conflicts.resolveAllHunks", {
                      resolved: resolutions.size,
                      total: hunkCount,
                    })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
