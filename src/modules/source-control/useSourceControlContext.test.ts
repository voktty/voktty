import { describe, expect, it } from "vitest";
import { shouldKeepSourceControlLive } from "./useSourceControlContext";

describe("shouldKeepSourceControlLive", () => {
  it("keeps live tracking for the open Source Control panel", () => {
    expect(shouldKeepSourceControlLive("source-control", false)).toBe(true);
  });

  it("keeps live tracking for Explorer only when decorations are visible", () => {
    expect(shouldKeepSourceControlLive("explorer", true)).toBe(true);
    expect(shouldKeepSourceControlLive("explorer", false)).toBe(false);
  });

  it("does not keep watchers alive only for the rail badge", () => {
    expect(shouldKeepSourceControlLive("outline", true)).toBe(false);
  });
});
