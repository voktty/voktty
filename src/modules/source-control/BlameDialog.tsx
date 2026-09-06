import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { native, type GitBlameLine } from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { useEffect, useMemo, useState } from "react";

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

function compactDate(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lines: GitBlameLine[] };

export function BlameDialog({
  open,
  onOpenChange,
  repoRoot,
  path,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string;
  path: string;
}) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    setState({ status: "loading" });
    let cancelled = false;
    void native
      .gitBlame(repoRoot, path, workspaceEnv)
      .then((lines) => {
        if (!cancelled) setState({ status: "ready", lines });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoRoot, path, workspaceEnv]);

  // Blame info repeats for every line from the same commit; only render it
  // on the first line of each consecutive run, like every real blame view.
  const showInfoAt = useMemo(() => {
    if (state.status !== "ready") return new Set<number>();
    const set = new Set<number>();
    let lastSha: string | null = null;
    state.lines.forEach((line, index) => {
      if (line.sha !== lastSha) {
        set.add(index);
        lastSha = line.sha;
      }
    });
    return set;
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-4xl bg-card/95 backdrop-blur-md border-border/80">
        <DialogHeader>
          <DialogTitle className="truncate font-mono text-sm font-semibold">
            {path}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("git.blame.dialogDesc")}
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
          ) : (
            <ScrollArea className="h-full max-h-[70vh]">
              <table className="w-full border-collapse font-mono text-[11px]">
                <tbody>
                  {state.lines.map((line, index) => (
                    <tr
                      key={line.lineNumber}
                      className="align-top hover:bg-muted/30"
                    >
                      <td className="w-64 min-w-0 border-r border-border/40 px-2 py-0.5 text-muted-foreground">
                        {showInfoAt.has(index) ? (
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="shrink-0 rounded bg-muted/65 px-1 py-0.5 text-[9.5px] tabular-nums">
                              {line.sha.slice(0, 7)}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {line.author}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {compactDate(line.authorTimeSecs)}
                            </span>
                          </div>
                        ) : null}
                      </td>
                      <td className="w-10 select-none px-2 py-0.5 text-right text-muted-foreground/60">
                        {line.lineNumber}
                      </td>
                      <td className="whitespace-pre px-2 py-0.5">
                        {line.content}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
