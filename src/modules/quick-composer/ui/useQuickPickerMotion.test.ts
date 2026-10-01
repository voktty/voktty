import { describe, expect, it } from "vitest";
import { useQuickPickerMotion } from "./useQuickPickerMotion";

describe("useQuickPickerMotion", () => {
  it("exports useQuickPickerMotion hook function", () => {
    expect(typeof useQuickPickerMotion).toBe("function");
  });
});
