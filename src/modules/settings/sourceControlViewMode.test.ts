import { describe, expect, it } from "vitest";
import { isSourceControlViewMode } from "./store";

describe("isSourceControlViewMode", () => {
  it("accepts the supported view modes", () => {
    expect(isSourceControlViewMode("list")).toBe(true);
    expect(isSourceControlViewMode("tree")).toBe(true);
  });

  it("rejects unknown persisted values", () => {
    expect(isSourceControlViewMode("grid")).toBe(false);
    expect(isSourceControlViewMode(null)).toBe(false);
    expect(isSourceControlViewMode(undefined)).toBe(false);
  });
});
