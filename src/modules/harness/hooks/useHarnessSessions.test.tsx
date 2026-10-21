// @vitest-environment happy-dom
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createHarnessSessionRuntime,
  type HarnessSessionRuntimeSnapshot,
} from "@/modules/harness/lib/harnessSessionRuntime";
import type { Session } from "@/modules/harness/lib/session";
import { useHarnessSessions } from "@/modules/harness/hooks/useHarnessSessions";

type Runtime = ReturnType<typeof createHarnessSessionRuntime>;
type Reader = Pick<Runtime, "subscribe" | "getSnapshot">;

function session(id: string, cwd = "/projects/local"): Session {
  return {
    id,
    cwd,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: id,
    blocks: [{ id: `${id}-reply`, role: "assistant", text: "Initial" }],
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a live session token.");
  return value;
}

function LocalLayoutView({
  runtime,
  observe,
}: {
  runtime: Reader;
  observe: (snapshot: HarnessSessionRuntimeSnapshot) => void;
}) {
  const snapshot = useHarnessSessions(runtime);
  const [selectedId, setSelectedId] = useState("local");
  const [compact, setCompact] = useState(false);
  observe(snapshot);
  const selected = snapshot.sessions.find((item) => item.id === selectedId);
  return (
    <section data-layout={compact ? "compact" : "expanded"}>
      {snapshot.sessions.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setSelectedId(item.id)}
        >
          {item.id}
        </button>
      ))}
      <button
        type="button"
        data-layout-toggle
        onClick={() => setCompact(!compact)}
      >
        Toggle layout
      </button>
      <output data-selected>{selectedId}</output>
      <output data-busy>{String(selected?.busy ?? false)}</output>
      <output data-transcript>
        {selected?.blocks.map((block) => block.text).join("|")}
      </output>
      <output data-all-busy>{snapshot.busySessionIds.join(",")}</output>
    </section>
  );
}

const mounts: { root: Root; container: HTMLDivElement; mounted: boolean }[] =
  [];

function mount(runtime: Reader, strict = false) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const entry = { root, container, mounted: true };
  mounts.push(entry);
  const observe = vi.fn<(snapshot: HarnessSessionRuntimeSnapshot) => void>();
  const render = (reader: Reader) => {
    const view = <LocalLayoutView runtime={reader} observe={observe} />;
    act(() => root.render(strict ? <StrictMode>{view}</StrictMode> : view));
  };
  render(runtime);
  return {
    container,
    observe,
    render,
    read: (selector: string) => container.querySelector(selector)?.textContent,
    click: (selector: string) => {
      const button = container.querySelector<HTMLButtonElement>(selector);
      if (!button) throw new Error(`Missing test button: ${selector}`);
      act(() => button.click());
    },
    unmount: () => {
      act(() => root.unmount());
      entry.mounted = false;
    },
  };
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  for (const entry of mounts.splice(0)) {
    if (entry.mounted) act(() => entry.root.unmount());
    entry.container.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shares live transcript and busy state while two mounted views navigate and lay out independently", () => {
  const loadSession = vi.fn<(id: string) => Promise<Session | undefined>>();
  const runtime = createHarnessSessionRuntime({ loadSession });
  runtime.admitSession(session("local"));
  runtime.admitSession(session("remote", "remote://voktty-ssh-test/repo"));
  const localTurn = required(runtime.beginTurn("local"));
  runtime.beginTurn("remote");
  const removeSession = vi.spyOn(runtime, "removeSession");
  const registerView = vi.spyOn(runtime, "registerView");
  const one = mount(runtime);
  const two = mount(runtime);

  act(() => {
    runtime.updateSession(localTurn, (current) => ({
      ...current,
      blocks: [
        {
          id: "local-reply",
          role: "assistant",
          text: "Streaming",
          streaming: true,
        },
      ],
    }));
  });
  expect(one.read("[data-transcript]")).toBe("Streaming");
  expect(two.read("[data-transcript]")).toBe("Streaming");
  expect(one.read("[data-busy]")).toBe("true");
  expect(two.read("[data-busy]")).toBe("true");
  expect(one.observe.mock.lastCall?.[0]).toBe(two.observe.mock.lastCall?.[0]);

  one.click("button:nth-of-type(2)");
  one.click("[data-layout-toggle]");
  expect(one.read("[data-selected]")).toBe("remote");
  expect(two.read("[data-selected]")).toBe("local");
  expect(one.container.querySelector("section")?.dataset.layout).toBe(
    "compact",
  );
  expect(two.container.querySelector("section")?.dataset.layout).toBe(
    "expanded",
  );
  const closedRenderCount = one.observe.mock.calls.length;
  one.unmount();

  act(() => {
    runtime.updateSession(localTurn, (current) => ({
      ...current,
      blocks: [{ id: "local-reply", role: "assistant", text: "Finished" }],
    }));
    runtime.completeTurn(localTurn);
  });
  expect(one.observe).toHaveBeenCalledTimes(closedRenderCount);
  expect(two.read("[data-transcript]")).toBe("Finished");
  expect(two.read("[data-busy]")).toBe("false");
  expect(two.read("[data-all-busy]")).toBe("remote");
  expect(runtime.getSession("remote")?.busy).toBe(true);
  expect(removeSession).not.toHaveBeenCalled();
  expect(registerView).not.toHaveBeenCalled();
  expect(loadSession).not.toHaveBeenCalled();
});

it("reopens the last unmounted view from the live snapshot without idle hydration or session removal", () => {
  const loadSession = vi
    .fn<(id: string) => Promise<Session | undefined>>()
    .mockResolvedValue(session("local"));
  const runtime = createHarnessSessionRuntime({ loadSession });
  runtime.admitSession(session("local"));
  const token = required(runtime.beginTurn("local"));
  const removeSession = vi.spyOn(runtime, "removeSession");
  const registerView = vi.spyOn(runtime, "registerView");
  const one = mount(runtime);
  one.unmount();
  act(() => {
    runtime.updateSession(token, (current) => ({
      ...current,
      blocks: [{ id: "local-reply", role: "assistant", text: "Still running" }],
    }));
  });
  const live = runtime.getSnapshot();
  const reopened = mount(runtime);
  expect(reopened.observe.mock.lastCall?.[0]).toBe(live);
  expect(reopened.read("[data-busy]")).toBe("true");
  expect(reopened.read("[data-transcript]")).toBe("Still running");
  act(() => {
    runtime.completeTurn(token);
  });
  expect(reopened.read("[data-busy]")).toBe("false");
  expect(removeSession).not.toHaveBeenCalled();
  expect(registerView).not.toHaveBeenCalled();
  expect(loadSession).not.toHaveBeenCalled();
});

it("returns the stable core snapshot and does not rerender for a no-op runtime update", () => {
  const runtime = createHarnessSessionRuntime({
    loadSession: async () => undefined,
  });
  runtime.admitSession(session("local"));
  const reader: Reader = {
    subscribe: runtime.subscribe,
    getSnapshot: runtime.getSnapshot,
  };
  const view = mount(reader);
  const snapshot = runtime.getSnapshot();
  expect(view.observe).toHaveBeenCalledTimes(1);
  expect(view.observe.mock.lastCall?.[0]).toBe(snapshot);
  act(() => {
    runtime.updateSession(
      required(runtime.captureSession("local")),
      (current) => current,
    );
  });
  expect(view.observe).toHaveBeenCalledTimes(1);
  view.click("[data-layout-toggle]");
  expect(view.observe).toHaveBeenCalledTimes(2);
  expect(view.observe.mock.lastCall?.[0]).toBe(snapshot);
  expect(runtime.getSnapshot()).toBe(snapshot);
});

it("cleans subscriptions during StrictMode replay, reader replacement and unmount without owning runtime views", () => {
  const makeTrackedRuntime = () => {
    const runtime = createHarnessSessionRuntime({
      loadSession: async () => undefined,
    });
    runtime.admitSession(session("local"));
    const subscribe = runtime.subscribe;
    const callbacks: ReturnType<typeof vi.fn<() => void>>[] = [];
    const cleanups: ReturnType<typeof vi.fn<() => void>>[] = [];
    vi.spyOn(runtime, "subscribe").mockImplementation((listener) => {
      const callback = vi.fn(listener);
      const release = subscribe(callback);
      const cleanup = vi.fn(release);
      callbacks.push(callback);
      cleanups.push(cleanup);
      return cleanup;
    });
    return { runtime, callbacks, cleanups };
  };
  const one = makeTrackedRuntime();
  const two = makeTrackedRuntime();
  const view = mount(one.runtime, true);
  expect(one.cleanups.length).toBeGreaterThanOrEqual(2);
  expect(
    one.cleanups.filter((cleanup) => cleanup.mock.calls.length === 0),
  ).toHaveLength(1);
  const snapshot = one.runtime.getSnapshot();
  expect(snapshot.views).toEqual([]);
  expect(snapshot.referencedSessionIds).toEqual([]);
  view.render(two.runtime);
  expect(one.cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(
    true,
  );
  one.callbacks.forEach((callback) => {
    callback.mockClear();
  });
  const renderCount = view.observe.mock.calls.length;
  act(() => {
    one.runtime.beginTurn("local");
  });
  expect(
    one.callbacks.every((callback) => callback.mock.calls.length === 0),
  ).toBe(true);
  expect(view.observe).toHaveBeenCalledTimes(renderCount);
  act(() => {
    two.runtime.beginTurn("local");
  });
  expect(view.read("[data-busy]")).toBe("true");
  view.unmount();
  expect(two.cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(
    true,
  );
  two.callbacks.forEach((callback) => {
    callback.mockClear();
  });
  act(() => {
    two.runtime.admitSession(session("remote"));
  });
  expect(
    two.callbacks.every((callback) => callback.mock.calls.length === 0),
  ).toBe(true);
  expect(two.runtime.getSnapshot().views).toEqual([]);
  expect(two.runtime.getSession("local")?.busy).toBe(true);
});
