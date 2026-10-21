// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ownHarnessUnloadSubscription,
  type HarnessUnloadDependencies,
} from "@/modules/harness/lib/harnessUnloadSubscription";

it("owns real StrictMode listeners and suppresses retired callbacks and in-flight reap on replacement", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const added: { name: string; listener: EventListener }[] = [];
  const live = new Map<string, Set<EventListener>>();
  const target: HarnessUnloadDependencies["target"] = {
    addEventListener: (name, listener) => {
      added.push({ name, listener });
      const listeners = live.get(name) ?? new Set<EventListener>();
      listeners.add(listener);
      live.set(name, listeners);
      window.addEventListener(name, listener);
    },
    removeEventListener: vi.fn((name, listener) => {
      expect(live.get(name)?.has(listener)).toBe(true);
      live.get(name)?.delete(listener);
      window.removeEventListener(name, listener);
      listener(new Event(name));
    }),
  };
  let finishPersist!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishPersist = resolve;
  });
  const dependencies: HarnessUnloadDependencies = {
    target,
    isAppQuitting: vi.fn(() => false),
    flush: vi.fn(),
    getSessions: vi.fn(() => []),
    getTabs: vi.fn(() => []),
    getActiveTabId: vi.fn(() => "tab"),
    getProjectCwd: vi.fn(() => "/project"),
    getProjectReturnMemory: vi.fn(() => new Map()),
    getProjectTerminals: vi.fn(() => []),
    persist: vi.fn(() => pending),
    reap: vi.fn(async () => {}),
  };
  function View({ deps }: { deps: HarnessUnloadDependencies }) {
    useEffect(() => {
      const subscription = ownHarnessUnloadSubscription(deps);
      return subscription.release;
    }, [deps]);
    return null;
  }
  let mounted = false;
  try {
    act(() =>
      root.render(
        <StrictMode>
          <View deps={dependencies} />
        </StrictMode>,
      ),
    );
    mounted = true;
    expect(added).toHaveLength(4);
    expect(live.get("pagehide")?.size).toBe(1);
    expect(live.get("beforeunload")?.size).toBe(1);
    for (const entry of added.slice(0, 2))
      entry.listener(new Event(entry.name));
    expect(dependencies.flush).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(dependencies.flush).toHaveBeenCalledTimes(1);
    expect(dependencies.persist).toHaveBeenCalledTimes(1);
    act(() =>
      root.render(
        <StrictMode>
          <View deps={{ ...dependencies }} />
        </StrictMode>,
      ),
    );
    expect(added).toHaveLength(6);
    expect(live.get("pagehide")?.size).toBe(1);
    expect(live.get("beforeunload")?.size).toBe(1);
    await act(async () => {
      finishPersist();
      await pending;
    });
    expect(dependencies.reap).not.toHaveBeenCalled();
    for (const entry of added.slice(0, 4))
      entry.listener(new Event(entry.name));
    expect(dependencies.flush).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(dependencies.flush).toHaveBeenCalledTimes(2);
    expect(dependencies.persist).toHaveBeenCalledTimes(2);
    expect(dependencies.reap).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    mounted = false;
    expect(target.removeEventListener).toHaveBeenCalledTimes(6);
    expect(live.get("pagehide")?.size).toBe(0);
    expect(live.get("beforeunload")?.size).toBe(0);
    for (const entry of added) entry.listener(new Event(entry.name));
    window.dispatchEvent(new Event("pagehide"));
    expect(dependencies.flush).toHaveBeenCalledTimes(2);
  } finally {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
