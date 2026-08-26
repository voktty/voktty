import { describe, expect, it } from "vitest";
import {
  avatarAnimationScale,
  avatarAnimationSpeed,
  avatarSizeScale,
} from "./settings";

describe("avatar settings", () => {
  it("maps the three size preferences to bounded visual scales", () => {
    expect(avatarSizeScale("compact")).toBeLessThan(1);
    expect(avatarSizeScale("standard")).toBe(1);
    expect(avatarSizeScale("large")).toBeGreaterThan(1);
  });

  it("maps animation intensity without allowing a stopped speed", () => {
    expect(avatarAnimationScale("low")).toBeLessThan(1);
    expect(avatarAnimationScale("high")).toBeGreaterThan(1);
    expect(avatarAnimationSpeed(0, "low")).toBeGreaterThanOrEqual(0.45);
    expect(avatarAnimationSpeed(1, "high")).toBeGreaterThan(
      avatarAnimationSpeed(1, "standard"),
    );
  });
});
