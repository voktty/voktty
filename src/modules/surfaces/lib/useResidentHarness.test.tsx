// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResidentHarness } from "@/modules/surfaces/lib/useResidentHarness";

type TabLike = { kind: string; spaceId: string };

function mount(options: {
  ready: boolean;
  tabs: TabLike[];
  newHarnessTab: ReturnType<typeof vi.fn>;
}) {
  const tabsRef = { current: options.tabs };
  function Probe() {
    useResidentHarness({
      ready: options.ready,
      spaceId: "space",
      tabsRef,
      localRoot: "/work",
      newHarnessTab: options.newHarnessTab as never,
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  return { root, tabsRef };
}

describe("useResidentHarness", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function runIdle() {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => callbacks.push(cb));
    vi.stubGlobal("cancelIdleCallback", () => {});
    return () => act(() => callbacks.splice(0).forEach((cb) => cb()));
  }

  it("waits for the restored tabs before creating anything", () => {
    const flush = runIdle();
    const newHarnessTab = vi.fn();
    mount({ ready: false, tabs: [], newHarnessTab });
    flush();
    expect(newHarnessTab).not.toHaveBeenCalled();
  });

  it("creates a background Harness without stealing focus from other tabs", () => {
    const flush = runIdle();
    const newHarnessTab = vi.fn();
    mount({ ready: true, tabs: [{ kind: "terminal", spaceId: "space" }], newHarnessTab });
    flush();
    expect(newHarnessTab).toHaveBeenCalledWith("space", "/work", undefined, {
      activate: false,
    });
  });

  it("shows the Harness when the space has nothing else", () => {
    const flush = runIdle();
    const newHarnessTab = vi.fn();
    mount({ ready: true, tabs: [], newHarnessTab });
    flush();
    expect(newHarnessTab).toHaveBeenCalledWith("space", "/work", undefined, {
      activate: true,
    });
  });

  it("leaves an existing or freshly restored Harness alone", () => {
    const flush = runIdle();
    const newHarnessTab = vi.fn();
    const { tabsRef } = mount({ ready: true, tabs: [], newHarnessTab });
    tabsRef.current = [{ kind: "harness", spaceId: "space" }];
    flush();
    expect(newHarnessTab).not.toHaveBeenCalled();
  });
});
