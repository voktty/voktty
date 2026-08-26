import { describe, expect, it } from "vitest";
import { indentGuideColumns } from "./structureGuides";

describe("indentGuideColumns", () => {
  it("returns one guide per complete space indent unit", () => {
    expect(indentGuideColumns("      value", "  ")).toEqual([2, 4, 6]);
  });

  it("handles tab indentation without expanding document text", () => {
    expect(indentGuideColumns("\t\tvalue", "\t")).toEqual([1, 2]);
  });

  it("caps deeply nested guides", () => {
    expect(indentGuideColumns(" ".repeat(80), "  ", 8)).toHaveLength(8);
  });
});
