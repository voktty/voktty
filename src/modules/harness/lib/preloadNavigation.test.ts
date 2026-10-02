import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preloadNavigationWhenIdle } from "./preloadNavigation";

describe("preloadNavigationWhenIdle", () => {
  let nextId: number;
  let frames: Map<number, FrameRequestCallback>;
  let idle: Map<number, () => void>;
  let stop: (() => void) | undefined;

  function paint() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  }

  beforeEach(() => {
    nextId = 0;
    frames = new Map();
    idle = new Map();
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++nextId, callback);
        return nextId;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      requestIdleCallback: (callback: () => void) => {
        idle.set(++nextId, callback);
        return nextId;
      },
      cancelIdleCallback: (id: number) => idle.delete(id),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("preloads after paint in idle time and tolerates a failed warmup", async () => {
    const inbox = vi.fn().mockRejectedValue(new Error("Unavailable"));
    const notes = vi.fn().mockResolvedValue(undefined);
    stop = preloadNavigationWhenIdle([inbox, notes]);
    paint();
    expect(idle.size).toBe(0);
    paint();
    expect(inbox).not.toHaveBeenCalled();
    expect(notes).not.toHaveBeenCalled();
    idle.forEach((callback) => callback());
    await Promise.resolve();
    expect(inbox).toHaveBeenCalledOnce();
    expect(notes).toHaveBeenCalledOnce();
  });

  it("cancels scheduled warmup when unmounted", () => {
    const load = vi.fn().mockResolvedValue(undefined);
    stop = preloadNavigationWhenIdle([load]);
    stop();
    paint();
    paint();
    expect(idle.size).toBe(0);
    stop = preloadNavigationWhenIdle([load]);
    paint();
    paint();
    stop();
    expect(idle.size).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it("waits for paint when requestIdleCallback is not available", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++nextId, callback);
        return nextId;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      requestIdleCallback: undefined,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const load = vi.fn().mockResolvedValue(undefined);
    stop = preloadNavigationWhenIdle([load]);
    vi.runAllTimers();
    paint();
    vi.runAllTimers();
    expect(load).not.toHaveBeenCalled();
    paint();
    vi.runAllTimers();
    expect(load).toHaveBeenCalledOnce();
  });
});
