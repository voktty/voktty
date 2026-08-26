import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useTranslation } from "@/modules/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  applyWorkspaceTextEdit,
  dirtyWorkspaceTextEditPaths,
  previewWorkspaceTextEdit,
  workspaceTextEditTargets,
} from "../lib/service";
import type {
  WorkspaceTextEditPreview,
  WorkspaceTextEditRequest,
} from "../types";

type Props = {
  request: WorkspaceTextEditRequest | null;
  workspace: WorkspaceEnv;
  dirtyPaths: string[];
  onClose: () => void;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; preview: WorkspaceTextEditPreview }
  | { kind: "error"; message: string };

export function WorkspaceTextEditDialog({
  request,
  workspace,
  dirtyPaths,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [applying, setApplying] = useState(false);
  const generation = useRef(0);

  const dirtyTargets = useMemo(() => {
    if (!request) return [];
    return dirtyWorkspaceTextEditPaths(
      request.root,
      request.documents,
      dirtyPaths,
    );
  }, [dirtyPaths, request]);

  useEffect(() => {
    if (!request) return;
    const current = ++generation.current;
    setApplying(false);
    if (dirtyTargets.length > 0) {
      setSelected(new Set());
      setState({
        kind: "error",
        message: t("editor.rename.dirtyBlocked", {
          count: dirtyTargets.length,
        }),
      });
      return;
    }
    setState({ kind: "loading" });
    void previewWorkspaceTextEdit(request.root, workspace, request.documents)
      .then((preview) => {
        if (generation.current !== current) return;
        setSelected(new Set(preview.files.map((file) => file.path)));
        setState({ kind: "ready", preview });
      })
      .catch((error) => {
        if (generation.current !== current) return;
        setState({ kind: "error", message: String(error) });
      });
  }, [dirtyTargets, request, t, workspace]);

  const close = useCallback(() => {
    if (applying) return;
    generation.current += 1;
    onClose();
  }, [applying, onClose]);

  const apply = async () => {
    if (!request || state.kind !== "ready" || applying) return;
    if (dirtyTargets.length > 0) {
      setState({
        kind: "error",
        message: t("editor.rename.dirtyBlocked", {
          count: dirtyTargets.length,
        }),
      });
      return;
    }
    const targets = workspaceTextEditTargets(
      state.preview.files,
      request.documents,
      selected,
    );
    if (targets.length === 0) return;
    setApplying(true);
    try {
      const outcome = await applyWorkspaceTextEdit(
        request.root,
        workspace,
        targets,
      );
      if (outcome.status === "applied") {
        toast.success(
          t("editor.rename.applied", {
            files: outcome.files,
            edits: outcome.edits,
          }),
        );
        generation.current += 1;
        onClose();
        return;
      }
      if (outcome.status === "conflict") {
        setState({
          kind: "error",
          message: outcome.rolledBack
            ? t("editor.rename.conflict", {
                count: outcome.conflicts.length,
              })
            : t("editor.rename.rollbackFailed", {
                error: t("editor.rename.conflict", {
                  count: outcome.conflicts.length,
                }),
                paths: outcome.rollbackFailures.join(", "),
              }),
        });
        return;
      }
      setState({
        kind: "error",
        message: outcome.rolledBack
          ? outcome.error
          : t("editor.rename.rollbackFailed", {
              error: outcome.error,
              paths: outcome.rollbackFailures.join(", "),
            }),
      });
    } catch (error) {
      setState({ kind: "error", message: String(error) });
    } finally {
      setApplying(false);
    }
  };

  const preview = state.kind === "ready" ? state.preview : null;
  const selectedEdits = preview?.files.reduce(
    (total, file) => total + (selected.has(file.path) ? file.edits : 0),
    0,
  );

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex max-h-[82vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onEscapeKeyDown={(event) => applying && event.preventDefault()}
        onPointerDownOutside={(event) => applying && event.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-5 pr-14">
          <DialogTitle>{t("editor.rename.previewTitle")}</DialogTitle>
          <DialogDescription>
            {request
              ? t("editor.rename.previewDescription", {
                  previous: request.previousName,
                  next: request.newName,
                  edits: request.totalEdits,
                })
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {state.kind === "loading" ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t("editor.rename.loadingPreview")}
            </div>
          ) : null}
          {state.kind === "error" ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {state.message}
            </div>
          ) : null}
          {preview?.files.map((file) => (
            <section
              key={file.path}
              className="mb-3 overflow-hidden rounded-xl border border-border/60 bg-background/40 last:mb-0"
            >
              <label className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-3 py-2.5">
                <Checkbox
                  checked={selected.has(file.path)}
                  disabled={applying}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(file.path);
                      else next.delete(file.path);
                      return next;
                    })
                  }
                  aria-label={t("editor.rename.selectFile", {
                    path: file.path,
                  })}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {file.path}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {t("editor.rename.editCount", { count: file.edits })}
                </span>
              </label>
              <div className="divide-y divide-border/40">
                {file.occurrences.map((occurrence, index) => (
                  <div
                    key={`${occurrence.line}:${occurrence.column}:${index}`}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 px-3 py-2 font-mono text-[11px] leading-5"
                  >
                    <span className="text-right text-muted-foreground">
                      {occurrence.line}:{occurrence.column}
                    </span>
                    <code className="min-w-0 whitespace-pre-wrap break-all text-muted-foreground">
                      {occurrence.before}
                      <span className="rounded bg-destructive/15 px-0.5 text-destructive line-through">
                        {occurrence.replaced}
                      </span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="rounded bg-emerald-500/15 px-0.5 text-emerald-500">
                        {occurrence.replacement}
                      </span>
                      {occurrence.after}
                    </code>
                  </div>
                ))}
              </div>
              {file.previewTruncated ? (
                <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                  {t("editor.rename.previewTruncated")}
                </div>
              ) : null}
            </section>
          ))}
        </div>

        <DialogFooter className="shrink-0 items-center border-t border-border/50 px-6 py-4 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {preview
              ? t("editor.rename.selectionSummary", {
                  files: selected.size,
                  edits: selectedEdits ?? 0,
                })
              : ""}
          </span>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={applying}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void apply()}
              disabled={!preview || selected.size === 0 || applying}
            >
              {applying
                ? t("editor.rename.applying")
                : t("editor.rename.apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
