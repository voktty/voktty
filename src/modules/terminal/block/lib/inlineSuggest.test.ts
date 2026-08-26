import { describe, expect, it } from "vitest";
import { extractNextWordChunk } from "./inlineSuggest";

describe("inlineSuggest", () => {
  it("extracts next single word or token from tail", () => {
    expect(extractNextWordChunk(" status")).toBe(" status");
    expect(extractNextWordChunk(" checkout main")).toBe(" checkout");
    expect(extractNextWordChunk("--hard HEAD~1")).toBe("--hard");
    expect(extractNextWordChunk("")).toBe("");
  });

  it("handles leading whitespace tokens appropriately", () => {
    expect(extractNextWordChunk("   ")).toBe("   ");
    expect(extractNextWordChunk("   build")).toBe("   build");
  });
});
