import type { EditorState } from "@codemirror/state";
import { create } from "zustand";

export type EditorCursorStatus = {
  line: number;
  column: number;
  selectionCharacters: number;
  selectionLines: number;
  selectionCount: number;
};

export type EditorStatus = EditorCursorStatus & {
  languageId: string;
  indentUnit: string;
  eol: "lf" | "crlf";
};

export const DEFAULT_EDITOR_STATUS: EditorStatus = {
  line: 1,
  column: 1,
  selectionCharacters: 0,
  selectionLines: 0,
  selectionCount: 0,
  languageId: "text",
  indentUnit: "  ",
  eol: "lf",
};

export function deriveEditorCursorStatus(
  state: EditorState,
): EditorCursorStatus {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  let selectionCharacters = 0;
  let selectionLines = 0;
  let selectionCount = 0;

  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    selectionCharacters += range.to - range.from;
    selectionLines +=
      state.doc.lineAt(range.to).number -
      state.doc.lineAt(range.from).number +
      1;
    selectionCount += 1;
  }

  return {
    line: line.number,
    column: main.head - line.from + 1,
    selectionCharacters,
    selectionLines,
    selectionCount,
  };
}

type EditorStatusState = {
  byEditorId: Record<number, EditorStatus>;
  report: (editorId: number, status: Partial<EditorStatus>) => void;
  remove: (editorId: number) => void;
};

export const useEditorStatusStore = create<EditorStatusState>((set) => ({
  byEditorId: {},
  report: (editorId, patch) =>
    set((state) => {
      const previous = state.byEditorId[editorId] ?? DEFAULT_EDITOR_STATUS;
      const next = { ...previous, ...patch };
      if (
        Object.keys(next).every(
          (key) =>
            next[key as keyof EditorStatus] ===
            previous[key as keyof EditorStatus],
        )
      ) {
        return state;
      }
      return {
        byEditorId: { ...state.byEditorId, [editorId]: next },
      };
    }),
  remove: (editorId) =>
    set((state) => {
      if (!state.byEditorId[editorId]) return state;
      const byEditorId = { ...state.byEditorId };
      delete byEditorId[editorId];
      return { byEditorId };
    }),
}));
