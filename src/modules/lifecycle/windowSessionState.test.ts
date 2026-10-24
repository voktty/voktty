import { describe, expect, it } from "vitest";
import { createWindowSessionState, MAX_HARNESS_WINDOW_STATE, parseHarnessWindowState } from "@/modules/lifecycle/windowSessionState";

describe("window session ownership", () => {
  const saved = { version: 1 as const, payload: "saved" };

  it("retains the last capture after release and rejects concurrent producers", () => {
    const state = createWindowSessionState();
    state.seed(saved, true);
    let payload = "first";
    const release = state.install(() => ({ version: 1, payload }));
    expect(() => state.install(() => saved)).toThrow("owner already exists");
    payload = "final";
    release();
    expect(state.capture()?.payload).toBe("final");
    const next = state.install(() => saved);
    release();
    expect(state.capture()).toEqual(saved);
    next();
  });

  it("releases a failed producer so StrictMode replacement can install", () => {
    const state = createWindowSessionState();
    state.seed(saved, true);
    const release = state.install(() => { throw new Error("capture failed"); });
    expect(release).toThrow("capture failed");
    expect(state.capture()).toEqual(saved);
    expect(() => state.install(() => saved)).not.toThrow();
  });

  it("preserves fresh boot and managed ownership after the producer leaves", () => {
    const state = createWindowSessionState();
    state.seed(undefined, false);
    state.manage();
    const release = state.install(() => saved);
    expect(() => state.seed(saved, true)).toThrow();
    release();
    expect(state.boot()).toEqual({ state: undefined, restore: false });
    expect(state.isManaged()).toBe(true);
  });

  it("bounds and copies the lazy envelope without importing the runtime", () => {
    expect(parseHarnessWindowState(saved)).toEqual(saved);
    expect(parseHarnessWindowState(saved)).not.toBe(saved);
    for (const value of [null, {}, { version: 2, payload: "" },
      { version: 1, payload: "x".repeat(MAX_HARNESS_WINDOW_STATE + 1) }])
      expect(parseHarnessWindowState(value)).toBeUndefined();
  });
});
