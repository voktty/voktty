import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  applyFormattedContent,
  formatterWorkspace,
  readFileText,
  resolveFormatter,
  runExternalFormatter,
} from "./externalFormat";

type Options = {
  path: string;
  workspaceEnv: WorkspaceEnv;
  getView: () => EditorView | undefined;
  getLanguage: () => string | null;
  isLspActive: () => boolean;
  formatLsp: (
    view: EditorView,
    isCurrent: () => boolean,
  ) => Promise<"done" | "unsupported">;
  save: () => Promise<boolean>;
  adoptDiskText: (text: string, mtime: number) => string;
  onBaseline: (view: EditorView, content: string) => void;
  onSaved: (isCurrent: () => boolean) => void;
};

let pending = 0;
const MAX_PENDING = 256;

export function useEditorFormatting(options: Options) {
  const { path, workspaceEnv } = options;
  const source = useMemo(
    () => ({
      path,
      workspace:
        workspaceEnv.kind === "ssh"
          ? { ...workspaceEnv, connection: { ...workspaceEnv.connection } }
          : { ...workspaceEnv },
    }),
    [path, workspaceEnv],
  );
  const ownerRef = useRef<{
    source: typeof source;
    warnedNoLsp: boolean;
    warnedNoFormat: boolean;
    tail?: Promise<void>;
  } | null>(null);
  useLayoutEffect(() => {
    const owner = { source, warnedNoLsp: false, warnedNoFormat: false };
    ownerRef.current = owner;
    return () => {
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [source]);
  const unavailableReason = formatterWorkspace(source.path, source.workspace)
    ? undefined
    : t("git.unsupportedFilesystem");

  const execute = useCallback(
    async (kind: "save" | "format") => {
      const owner = ownerRef.current;
      if (!owner || owner.source !== source) return;
      const view = options.getView();
      const current = () => {
        const sameView = options.getView() === view;
        return (
          sameView && ownerRef.current === owner && owner.source === source
        );
      };
      if (!current() || (kind === "format" && !view)) return;
      if (pending >= MAX_PENDING) {
        toast.error(t("feedback.editorUnavailable"));
        return;
      }
      const prefs = usePreferencesStore.getState();
      const formatter = resolveFormatter(options.getLanguage(), prefs);
      const custom = prefs.editorCustomFormatCommand;
      const formatOnSave = prefs.editorFormatOnSave;
      const allowed = formatterWorkspace(source.path, source.workspace);
      const lspActive = options.isLspActive();
      const previous = owner.tail;
      let release!: () => void;
      const completion = new Promise<void>((resolve) => {
        release = resolve;
      });
      owner.tail = completion;
      pending++;
      try {
        if (previous) await previous;
        if (!current()) return;
        if (kind === "format" && !allowed) {
          toast.warning(t("git.unsupportedFilesystem"));
          return;
        }
        if (kind === "format" && lspActive && view) {
          await options.formatLsp(view, current);
          return;
        }
        if (kind === "format" && formatter === "lsp") return;
        if (kind === "save" && formatOnSave) {
          if (!allowed) {
            toast.warning(t("feedback.editorFormatOnSaveSkipped"), {
              description: t("git.unsupportedFilesystem"),
            });
          } else if (formatter === "lsp" && view) {
            if (lspActive) {
              let result: "done" | "unsupported" = "done";
              try {
                result = await options.formatLsp(view, current);
              } catch (error) {
                if (current())
                  toast.error(t("feedback.editorLanguageServerFormatFailed"), {
                    description: String(error),
                  });
              }
              if (!current()) return;
              if (result === "unsupported" && !owner.warnedNoFormat) {
                owner.warnedNoFormat = true;
                toast.warning(t("feedback.editorFormatOnSaveSkipped"), {
                  description: t("feedback.editorNoFormatter"),
                });
              }
            } else if (!owner.warnedNoLsp) {
              owner.warnedNoLsp = true;
              toast.warning(t("feedback.editorFormatOnSaveSkipped"), {
                description: t("feedback.editorNoLanguageServer"),
              });
            }
          }
        }
        if (!current()) return;
        const docAtSave = view?.state.doc;
        if (!(await options.save()) || !current()) return;
        if (view && docAtSave) options.onBaseline(view, docAtSave.toString());
        if (!current()) return;
        if (
          allowed &&
          formatter !== "lsp" &&
          (kind === "format" || formatOnSave) &&
          view &&
          view.state.doc === docAtSave
        ) {
          const error = await runExternalFormatter(
            formatter,
            source.path,
            custom,
            allowed,
            current,
          );
          if (!current()) return;
          if (error) {
            toast.error(t("feedback.formatterFormatFailed", { formatter }), {
              description: error,
            });
          } else if (view.state.doc === docAtSave) {
            const readBack = await readFileText(source.path, allowed, current);
            if (!current()) return;
            if (readBack && view.state.doc === docAtSave) {
              const content = options.adoptDiskText(
                readBack.text,
                readBack.mtime,
              );
              if (!current()) return;
              applyFormattedContent(view, content);
              if (!current()) return;
              options.onBaseline(view, content);
            }
          }
        }
        if (kind === "save" && current()) options.onSaved(current);
      } catch (error) {
        if (current())
          toast.error(t("feedback.editorFormatFailed"), {
            description: String(error),
          });
      } finally {
        pending--;
        if (owner.tail === completion) owner.tail = undefined;
        release();
      }
    },
    [options, source],
  );
  return {
    save: () => execute("save"),
    format: () => execute("format"),
    unavailableReason,
  };
}
