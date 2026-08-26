import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { deriveEditorCursorStatus, useEditorStatusStore } from "./editorStatus";

describe("deriveEditorCursorStatus", () => {
  it("reports one-based line and column coordinates", () => {
    const state = EditorState.create({
      doc: "first\nsecond",
      selection: { anchor: 8 },
    });

    expect(deriveEditorCursorStatus(state)).toMatchObject({
      line: 2,
      column: 3,
    });
  });

  it("reports selected characters, lines, and ranges", () => {
    const state = EditorState.create({
      doc: "one\ntwo\nthree",
      selection: EditorSelection.create(
        [EditorSelection.range(0, 3), EditorSelection.range(4, 7)],
        1,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });

    expect(deriveEditorCursorStatus(state)).toEqual({
      line: 2,
      column: 4,
      selectionCharacters: 6,
      selectionLines: 2,
      selectionCount: 2,
    });
  });

  it("does not count empty cursors as selections", () => {
    const state = EditorState.create({
      doc: "one\ntwo",
      selection: { anchor: 4 },
    });

    expect(deriveEditorCursorStatus(state)).toMatchObject({
      selectionCharacters: 0,
      selectionLines: 0,
      selectionCount: 0,
    });
  });

  it("publishes EOL changes for an existing editor", () => {
    const editorId = 701;
    const store = useEditorStatusStore.getState();

    store.report(editorId, { eol: "crlf" });
    expect(useEditorStatusStore.getState().byEditorId[editorId]?.eol).toBe(
      "crlf",
    );

    store.report(editorId, { eol: "lf" });
    expect(useEditorStatusStore.getState().byEditorId[editorId]?.eol).toBe(
      "lf",
    );

    store.remove(editorId);
  });
});
