import { describe, expect, it } from "vitest";
import { getOptimalInitialZoomLevel } from "./optimalZoom";

describe("getOptimalInitialZoomLevel", () => {
  it("returns 0.85 for small / low-res screens (height <= 768 or width <= 1280)", () => {
    expect(getOptimalInitialZoomLevel({ width: 1280, height: 720 })).toBe(0.85);
    expect(getOptimalInitialZoomLevel({ width: 1366, height: 768 })).toBe(0.85);
    expect(getOptimalInitialZoomLevel({ width: 1024, height: 768 })).toBe(0.85);
  });

  it("returns 0.9 for standard laptop screens (height <= 920 or width <= 1440)", () => {
    // 1440x900 MacBook or 2880x1800 @ 2x scaling
    expect(getOptimalInitialZoomLevel({ width: 1440, height: 900 })).toBe(0.9);
    // 1080p with 125% Windows scaling (1536x864)
    expect(getOptimalInitialZoomLevel({ width: 1536, height: 864 })).toBe(0.9);
  });

  it("returns 0.95 for standard 1080p displays (height <= 1080)", () => {
    expect(getOptimalInitialZoomLevel({ width: 1920, height: 1080 })).toBe(0.95);
    expect(getOptimalInitialZoomLevel({ width: 1680, height: 1050 })).toBe(0.95);
  });

  it("returns 1.0 for large / 1440p / 4K monitors", () => {
    expect(getOptimalInitialZoomLevel({ width: 2560, height: 1440 })).toBe(1.0);
    expect(getOptimalInitialZoomLevel({ width: 3840, height: 2160 })).toBe(1.0);
  });

  it("falls back to 1.0 when screen dimensions are missing or invalid", () => {
    expect(getOptimalInitialZoomLevel(null)).toBe(1.0);
    expect(getOptimalInitialZoomLevel({ width: 0, height: 0 })).toBe(1.0);
  });
});
