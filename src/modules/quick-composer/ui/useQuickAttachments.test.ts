import { describe, expect, it } from "vitest";
import { useQuickAttachments } from "./useQuickAttachments";

describe("useQuickAttachments", () => {
  it("exports useQuickAttachments hook function", () => {
    expect(typeof useQuickAttachments).toBe("function");
  });
});
