import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  isSidebarViewId,
  shouldPersistSidebarWidth,
} from "./useSidebarPanel";

describe("useSidebarPanel", () => {
  it("only persists a positive width from direct user interaction", () => {
    expect(shouldPersistSidebarWidth(320, true)).toBe(true);
    expect(shouldPersistSidebarWidth(320, false)).toBe(false);
    expect(shouldPersistSidebarWidth(0, true)).toBe(false);
  });

  it("clamps sidebar width within min/max bounds", () => {
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(600)).toBe(480);
  });

  it("accepts Outline as a persisted sidebar view", () => {
    expect(isSidebarViewId("outline")).toBe(true);
    expect(isSidebarViewId("problems")).toBe(true);
    expect(isSidebarViewId("unknown")).toBe(false);
  });
});
