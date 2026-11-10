// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { applyUiScale, UI_SCALE_MAX, UI_SCALE_MIN } from "./useZoom";

const read = () =>
  document.documentElement.style.getPropertyValue("--chrome-scale");

describe("applyUiScale", () => {
  afterEach(() => document.documentElement.style.removeProperty("--chrome-scale"));

  it("applies an in-range scale untouched", () => {
    applyUiScale(0.9);
    expect(read()).toBe("0.9");
  });

  it("clamps values that would make the interface unusable", () => {
    applyUiScale(0.1);
    expect(read()).toBe(String(UI_SCALE_MIN));
    applyUiScale(9);
    expect(read()).toBe(String(UI_SCALE_MAX));
  });

  it("falls back to 1 for a corrupted stored value", () => {
    applyUiScale(Number.NaN);
    expect(read()).toBe("1");
  });
});
