import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { t } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import { requestInlineEdit } from "@/modules/editor/lib/inlineEditService";
import {
  captureInlineEditTarget,
  type InlineEditProposal,
} from "@/modules/editor/lib/inlineEditTarget";

type Options = {
  path: string;
  workspaceEnv: WorkspaceEnv;
  getView: () => EditorView | undefined;
  getLanguage: () => string | null;
  onApplied: () => void;
};

export function useEditorInlineEdit(options: Options) {
  const { path, workspaceEnv } = options;
  const source = useMemo(
    () => ({ path, workspace: structuredClone(workspaceEnv) }),
    [path, workspaceEnv],
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;
  type Owner = {
    source: typeof source;
    pending: Set<AbortController>;
    request?: object;
    proposal?: InlineEditProposal;
  };
  const ownerRef = useRef<Owner | null>(null);
  useLayoutEffect(() => {
    const owner: Owner = { source, pending: new Set<AbortController>() };
    ownerRef.current = owner;
    return () => {
      if (ownerRef.current === owner) ownerRef.current = null;
      owner.proposal = undefined;
      for (const controller of owner.pending) controller.abort();
    };
  }, [source]);

  return useCallback(
    async (
      instruction: string,
      signal?: AbortSignal,
    ): Promise<InlineEditProposal> => {
      const owner = ownerRef.current;
      const view = optionsRef.current.getView();
      if (
        !owner ||
        ownerRef.current !== owner ||
        owner.source !== source ||
        !view ||
        signal?.aborted ||
        owner.pending.size >= 256
      )
        throw new Error(t("feedback.editorUnavailable"));
      owner.proposal = undefined;
      for (const controller of owner.pending) controller.abort();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const request = {};
      owner.request = request;
      owner.pending.add(controller);
      const current = () =>
        ownerRef.current === owner &&
        owner.request === request &&
        optionsRef.current.getView() === view &&
        !signal?.aborted &&
        !controller.signal.aborted;
      const target = captureInlineEditTarget(view.state);
      const onApplied = optionsRef.current.onApplied;
      try {
        const language = optionsRef.current.getLanguage() ?? undefined;
        if (!current()) throw new Error(t("feedback.editorUnavailable"));
        const text = await requestInlineEdit(
          {
            instruction,
            path: source.path,
            workspaceEnv: source.workspace,
            language,
            code: target.code,
            prefix: target.prefix,
            suffix: target.suffix,
          },
          undefined,
          controller.signal,
        );
        if (!current() || view.state.doc !== target.document)
          throw new Error(t("editor.codeActions.documentChanged"));
        let used = false;
        const proposal: InlineEditProposal = Object.freeze({
          text,
          apply: () => {
            if (used) return false;
            used = true;
            const ownsProposal = owner.proposal === proposal;
            if (ownsProposal) owner.proposal = undefined;
            if (
              !ownsProposal ||
              !current() ||
              view.state.doc !== target.document
            )
              return false;
            view.dispatch({
              changes: { from: target.from, to: target.to, insert: text },
              annotations: [
                Transaction.userEvent.of("input.inline-ai"),
                isolateHistory.of("full"),
              ],
            });
            if (current()) onApplied();
            return true;
          },
          discard: () => {
            used = true;
            if (owner.proposal === proposal) owner.proposal = undefined;
          },
        });
        owner.proposal = proposal;
        return proposal;
      } finally {
        signal?.removeEventListener("abort", abort);
        owner.pending.delete(controller);
      }
    },
    [source],
  );
}
