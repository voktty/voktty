import { describe, expect, it } from "vitest";
import { partialSuggestionChunk } from "./completionParts";

describe("partialSuggestionChunk", () => {
  it("accepts one semantic token while preserving leading whitespace", () => {
    expect(partialSuggestionChunk("  customer.name + suffix", "token")).toBe(
      "  customer",
    );
  });

  it("accepts exactly the first logical line", () => {
    expect(partialSuggestionChunk("value += 1;\nreturn value;", "line")).toBe(
      "value += 1;\n",
    );
  });

  it("falls back to the full suggestion when it has no smaller part", () => {
    expect(partialSuggestionChunk("}", "token")).toBe("}");
  });
});
