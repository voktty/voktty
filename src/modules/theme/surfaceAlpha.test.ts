import { describe, expect, it } from "vitest";
import { POPOVER_MIN_ALPHA, surfaceAlphas } from "./surfaceAlpha";

describe("surfaceAlphas", () => {
  it("puts the whole chrome opacity on the frame", () => {
    expect(surfaceAlphas(0.6).frame).toBe(0.6);
    expect(surfaceAlphas(1).frame).toBe(1);
  });

  it("lifts raised surfaces a little above the frame, never past opaque", () => {
    expect(surfaceAlphas(0.6).card).toBeCloseTo(0.72);
    expect(surfaceAlphas(0.95).card).toBe(1);
    expect(surfaceAlphas(0.1).card).toBe(0.35);
  });

  it("keeps menus legible however transparent the window is", () => {
    expect(surfaceAlphas(0.2).popover).toBe(POPOVER_MIN_ALPHA);
    expect(surfaceAlphas(0.97).popover).toBe(0.97);
  });

  it("moves every surface with the one setting", () => {
    const low = surfaceAlphas(0.3);
    const high = surfaceAlphas(0.8);
    expect(high.frame).toBeGreaterThan(low.frame);
    expect(high.card).toBeGreaterThan(low.card);
    expect(high.activeItem).toBeGreaterThanOrEqual(low.activeItem);
  });

  it("treats a broken value as opaque", () => {
    expect(surfaceAlphas(Number.NaN).frame).toBe(1);
  });
});
