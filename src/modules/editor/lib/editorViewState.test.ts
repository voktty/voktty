import { describe, expect, it } from "vitest";
import { normalizeEditorViewState } from "./editorViewState";

describe("normalizeEditorViewState", () => {
  it("bounds restored selections and scroll offsets", () => {
    expect(
      normalizeEditorViewState(
        { anchor: 90, head: -5, scrollTop: -20, scrollLeft: 40 },
        12,
      ),
    ).toEqual({ anchor: 12, head: 0, scrollTop: 0, scrollLeft: 40 });
  });

  it("rejects non-finite persisted numbers", () => {
    expect(
      normalizeEditorViewState(
        {
          anchor: Number.NaN,
          head: Number.POSITIVE_INFINITY,
          scrollTop: Number.NaN,
          scrollLeft: Number.NEGATIVE_INFINITY,
        },
        20,
      ),
    ).toEqual({ anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0 });
  });
});
