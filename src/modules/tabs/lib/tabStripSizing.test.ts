import { describe, expect, it } from "vitest";
import { preferredTabBarWidth, TAB_PREFERRED_WIDTH_PX } from "./tabStripSizing";

describe("preferredTabBarWidth", () => {
  it("keeps the new-tab control next to an empty projected strip", () => {
    expect(preferredTabBarWidth(0, false)).toBe(28);
  });

  it("allows every visible item to reach its preferred width", () => {
    expect(preferredTabBarWidth(1, false)).toBe(
      TAB_PREFERRED_WIDTH_PX + 26 + 2,
    );
    expect(preferredTabBarWidth(3, false)).toBe(
      TAB_PREFERRED_WIDTH_PX * 3 + 26 + 6,
    );
  });

  it("reserves room for the open-tabs control when it is visible", () => {
    expect(preferredTabBarWidth(6, true)).toBe(
      TAB_PREFERRED_WIDTH_PX * 6 + 26 + 40 + 14,
    );
  });

  it("normalizes invalid negative counts", () => {
    expect(preferredTabBarWidth(-2, false)).toBe(28);
  });
});
