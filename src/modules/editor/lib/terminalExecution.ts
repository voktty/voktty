import {
  getAnyLiveTerminalLeafId,
  submitToLeaf,
} from "@/modules/terminal/lib/useTerminalSession";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { toast } from "sonner";
import { t } from "@/modules/i18n";

export type TerminalTarget = {
  activeLeafId: number;
};

export function findTargetTerminalTab(tabs: Tab[], spaceId?: string): TerminalTarget | null {
  const terminalTabs = tabs.filter(
    (t): t is Extract<Tab, { kind: "terminal" }> =>
      t.kind === "terminal" && (spaceId ? t.spaceId === spaceId : true),
  );
  if (terminalTabs.length === 0) return null;
  return { activeLeafId: terminalTabs[0].activeLeafId };
}

export function extractCodeToExecute(view: EditorView): { text: string; nextLineAnchor?: number } | null {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    const selected = view.state.sliceDoc(from, to).trim();
    if (selected) return { text: selected };
  }

  // If no selection, take the full current line
  const line = view.state.doc.lineAt(from);
  const lineText = line.text.trim();
  if (!lineText) return null;

  // Next line start position for cursor advance
  const nextLineAnchor = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1).from : undefined;

  return { text: lineText, nextLineAnchor };
}

export function executeCodeInTerminal(
  code: string,
  targetLeafId: number,
): boolean {
  if (!code || !targetLeafId) return false;
  submitToLeaf(targetLeafId, code);
  return true;
}

export function sendActiveEditorCodeToTerminal(view: EditorView): boolean {
  const extracted = extractCodeToExecute(view);
  if (!extracted) return false;

  const leafId = getAnyLiveTerminalLeafId();
  if (leafId === null) {
    toast.error(t("editor.terminalNoActive"));
    return false;
  }

  submitToLeaf(leafId, extracted.text);
  toast.success(t("editor.terminalCodeSent"));

  if (extracted.nextLineAnchor !== undefined) {
    view.dispatch({
      selection: EditorSelection.cursor(extracted.nextLineAnchor),
    });
  }

  return true;
}
