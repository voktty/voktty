import { editorSelectionForLocation } from "@/modules/editor/lib/editorLocation";
import { describe, expect, it } from "vitest";

describe("editor location navigation", () => {
  it("converts a one-based column into an exact selected range", () => {
    expect(editorSelectionForLocation(20, 40, 4, 6)).toEqual({
      anchor: 23,
      head: 29,
    });
  });

  it("clamps stale locations to the current line", () => {
    expect(editorSelectionForLocation(20, 24, 99, 8)).toEqual({
      anchor: 24,
      head: 24,
    });
  });
});
