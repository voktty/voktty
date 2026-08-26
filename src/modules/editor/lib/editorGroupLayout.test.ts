import { describe, expect, it } from "vitest";
import {
  activateEditorInLayout,
  closeEditorGroup,
  createEditorGroupLayout,
  editorGroupLeaves,
  focusEditorGroup,
  retainEditorsInLayout,
  splitEditorGroup,
} from "./editorGroupLayout";

describe("editorGroupLayout", () => {
  it("opens editors in the active group and keeps other groups stable", () => {
    let layout = createEditorGroupLayout(1);
    layout = activateEditorInLayout(layout, 10);
    layout = splitEditorGroup(layout, "row", 2);
    layout = activateEditorInLayout(layout, 20);

    expect(editorGroupLeaves(layout.tree)).toEqual([
      { groupId: 1, tabId: 10 },
      { groupId: 2, tabId: 20 },
    ]);
    expect(layout.activeGroupId).toBe(2);
  });

  it("collapses a split when one group closes", () => {
    let layout = activateEditorInLayout(createEditorGroupLayout(1), 10);
    layout = splitEditorGroup(layout, "col", 2);
    layout = activateEditorInLayout(layout, 20);
    layout = closeEditorGroup(layout, 2);

    expect(layout.tree).toEqual({ kind: "leaf", groupId: 1, tabId: 10 });
    expect(layout.activeGroupId).toBe(1);
  });

  it("does not assign one editor tab to two groups", () => {
    let layout = activateEditorInLayout(createEditorGroupLayout(1), 10);
    layout = splitEditorGroup(layout, "row", 2);
    layout = activateEditorInLayout(layout, 10);

    expect(editorGroupLeaves(layout.tree)).toEqual([
      { groupId: 1, tabId: null },
      { groupId: 2, tabId: 10 },
    ]);
  });

  it("clears closed editor references without collapsing groups", () => {
    let layout = activateEditorInLayout(createEditorGroupLayout(1), 10);
    layout = splitEditorGroup(layout, "row", 2);
    layout = activateEditorInLayout(layout, 20);

    expect(
      editorGroupLeaves(retainEditorsInLayout(layout, new Set([20])).tree),
    ).toEqual([
      { groupId: 1, tabId: null },
      { groupId: 2, tabId: 20 },
    ]);
  });

  it("preserves layout identity when the active group receives focus again", () => {
    const layout = createEditorGroupLayout(1);

    expect(focusEditorGroup(layout, 1)).toBe(layout);
  });
});
