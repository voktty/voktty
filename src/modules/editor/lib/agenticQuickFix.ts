import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { t as translate } from "@/modules/i18n";

export type QuickFixTarget = {
  diagnostics: Diagnostic[];
  prompt: string;
  from: number;
  to: number;
};

/**
 * Finds all LSP/compiler diagnostics affecting the current cursor line or selection.
 */
export function getDiagnosticsAtCursor(view: EditorView): Diagnostic[] {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const lineFrom = line.from;
  const lineTo = line.to;

  const results: Diagnostic[] = [];
  forEachDiagnostic(view.state, (diag) => {
    // Check if diagnostic overlaps the current line or selection
    const overlapsLine =
      (diag.from >= lineFrom && diag.from <= lineTo) ||
      (diag.to >= lineFrom && diag.to <= lineTo) ||
      (diag.from <= from && diag.to >= to);

    if (overlapsLine) {
      results.push(diag);
    }
  });

  return results;
}

/**
 * Generates an optimized AI prompt to fix the diagnostics.
 */
export function buildQuickFixPrompt(
  diagnostics: Diagnostic[],
  t: (key: string, params?: Record<string, string | number>) => string = translate,
): string {
  if (diagnostics.length === 0) {
    return t("editor.quickFix.fallbackPrompt");
  }

  const errors = diagnostics
    .map((d, index) => `${index + 1}. [${d.severity.toUpperCase()}] ${d.message}`)
    .join("\n");

  return t("editor.quickFix.diagnosticsPrompt", { errors });
}

/**
 * Resolves the code target range for the quick fix (expanding from the diagnostic to the statement or surrounding block if needed).
 */
export function resolveQuickFixRange(
  view: EditorView,
  diagnostics: Diagnostic[],
): { from: number; to: number } {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    return { from, to };
  }

  const doc = view.state.doc;
  if (diagnostics.length > 0) {
    const minFrom = Math.min(...diagnostics.map((d) => d.from));
    const maxTo = Math.max(...diagnostics.map((d) => d.to));

    // Clamp to line boundaries for clean replacement
    const startLine = doc.lineAt(minFrom);
    const endLine = doc.lineAt(maxTo);
    return { from: startLine.from, to: endLine.to };
  }

  const curLine = doc.lineAt(from);
  return { from: curLine.from, to: curLine.to };
}
