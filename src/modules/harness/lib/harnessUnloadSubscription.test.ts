import { describe, expect, it, vi } from "vitest";
import {
  ownHarnessUnloadSubscription,
  type HarnessUnloadCapture,
  type HarnessUnloadDependencies,
} from "@/modules/harness/lib/harnessUnloadSubscription";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const listeners = new Map<string, EventListener>();
  const cached: EventListener[] = [];
  let capture: HarnessUnloadCapture = {
    sessions: [
      {
        id: "session",
        harness: "codex",
        model: "model",
        modelSettings: {},
        runtimeMode: "supervised",
        title: "Conversation",
        cwd: "/old-project",
        blocks: [],
        busy: true,
        providerSessionId: "old-provider",
      },
    ],
    tabs: [
      {
        kind: "session",
        id: "old-tab",
        layout: { type: "leaf", id: "session" },
        focusedId: "session",
        filePanes: [],
      },
    ],
    activeTabId: "old-tab",
    projectCwd: "/old-project",
    projectReturnMemory: new Map([["old-project", "old-tab"]]),
    projectTerminals: [
      {
        projectPath: "/old-project",
        side: "bottom",
        size: 200,
        open: true,
        pane: {
          id: "dock-pane",
          activeFileId: "old-pty",
          files: [
            { id: "old-pty", path: "", cwd: "/old-project", terminal: true },
          ],
        },
      },
    ],
  };
  const pending = deferred();
  const dependencies: HarnessUnloadDependencies = {
    target: {
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        listeners.set(name, listener);
        cached.push(listener);
      }),
      removeEventListener: vi.fn((name: string, listener: EventListener) => {
        expect(listeners.get(name)).toBe(listener);
        listeners.delete(name);
      }),
    },
    isAppQuitting: vi.fn(() => false),
    flush: vi.fn(),
    getSessions: vi.fn(() => capture.sessions),
    getTabs: vi.fn(() => capture.tabs),
    getActiveTabId: vi.fn(() => capture.activeTabId),
    getProjectCwd: vi.fn(() => capture.projectCwd),
    getProjectReturnMemory: vi.fn(() => capture.projectReturnMemory),
    getProjectTerminals: vi.fn(() => capture.projectTerminals),
    persist: vi.fn(() => pending.promise),
    reap: vi.fn(async () => {}),
  };
  const dispatch = (name = "pagehide") =>
    listeners.get(name)?.(new Event(name));
  const getters = [
    dependencies.getSessions,
    dependencies.getTabs,
    dependencies.getActiveTabId,
    dependencies.getProjectCwd,
    dependencies.getProjectReturnMemory,
    dependencies.getProjectTerminals,
  ];
  return {
    dependencies,
    pending,
    listeners,
    cached,
    dispatch,
    getters,
    read: () => capture,
    replace: () => {
      capture = {
        sessions: [],
        tabs: [],
        activeTabId: "new-tab",
        projectCwd: "/new-project",
        projectReturnMemory: new Map(),
        projectTerminals: [],
      };
    },
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

describe("owned Harness unload subscription", () => {
  it.each([
    ["pagehide", "beforeunload"],
    ["beforeunload", "pagehide"],
  ])(
    "coalesces %s then %s including repeated events",
    async (first, second) => {
      const f = fixture();
      const owner = ownHarnessUnloadSubscription(f.dependencies);
      f.dispatch(first);
      f.dispatch(second);
      f.dispatch(first);
      expect(f.dependencies.flush).toHaveBeenCalledTimes(1);
      for (const get of f.getters) expect(get).toHaveBeenCalledTimes(1);
      expect(f.dependencies.persist).toHaveBeenCalledTimes(1);
      f.pending.resolve();
      await settle();
      expect(f.dependencies.reap).toHaveBeenCalledTimes(1);
      owner.release();
    },
  );

  it("latches before a reentrant flush dispatch", async () => {
    const f = fixture();
    vi.mocked(f.dependencies.flush).mockImplementation(() =>
      f.dispatch("beforeunload"),
    );
    const owner = ownHarnessUnloadSubscription(f.dependencies);
    f.dispatch();
    expect(f.dependencies.flush).toHaveBeenCalledTimes(1);
    expect(f.dependencies.persist).toHaveBeenCalledTimes(1);
    f.pending.resolve();
    await settle();
    owner.release();
  });

  it("flushes before every getter and captures all getters before persistence", async () => {
    const f = fixture();
    const order: string[] = [];
    vi.mocked(f.dependencies.flush).mockImplementation(() => {
      order.push("flush");
      f.replace();
    });
    vi.mocked(f.dependencies.persist).mockImplementation((capture) => {
      order.push("persist");
      for (const get of f.getters) expect(get).toHaveBeenCalledTimes(1);
      expect(capture.activeTabId).toBe("new-tab");
      expect(Object.isFrozen(capture)).toBe(true);
      return f.pending.promise;
    });
    const owner = ownHarnessUnloadSubscription(f.dependencies);
    f.dispatch();
    const flushOrder = vi.mocked(f.dependencies.flush).mock
      .invocationCallOrder[0];
    const persistOrder = vi.mocked(f.dependencies.persist).mock
      .invocationCallOrder[0];
    for (const get of f.getters) {
      const getterOrder = vi.mocked(get).mock.invocationCallOrder[0];
      expect(getterOrder).toBeGreaterThan(flushOrder);
      expect(getterOrder).toBeLessThan(persistOrder);
    }
    expect(order).toEqual(["flush", "persist"]);
    f.pending.resolve();
    await settle();
    owner.release();
  });

  it("persists and reaps the same captured references despite replacement", async () => {
    const f = fixture();
    const before = f.read();
    const owner = ownHarnessUnloadSubscription(f.dependencies);
    f.dispatch();
    f.replace();
    f.pending.resolve();
    await settle();
    const persisted = vi.mocked(f.dependencies.persist).mock.calls[0][0];
    const reaped = vi.mocked(f.dependencies.reap).mock.calls[0][0];
    expect(reaped).toBe(persisted);
    for (const key of [
      "sessions",
      "tabs",
      "projectTerminals",
      "projectReturnMemory",
    ] as const) {
      expect(reaped[key]).toBe(before[key]);
      expect(reaped[key]).not.toBe(f.read()[key]);
    }
    for (const get of f.getters) expect(get).toHaveBeenCalledTimes(1);
    owner.release();
  });

  it("retires before exact idempotent removal so cached callbacks are inert", () => {
    const f = fixture();
    const owner = ownHarnessUnloadSubscription(f.dependencies);
    vi.mocked(f.dependencies.target.removeEventListener).mockImplementation(
      (name, listener) => {
        listener(new Event(name));
        f.listeners.delete(name);
      },
    );
    owner.release();
    owner.release();
    for (const listener of f.cached) listener(new Event("pagehide"));
    expect(f.dependencies.target.removeEventListener).toHaveBeenCalledTimes(2);
    expect(f.listeners.size).toBe(0);
    expect(f.dependencies.isAppQuitting).not.toHaveBeenCalled();
    expect(f.dependencies.flush).not.toHaveBeenCalled();
    for (const get of f.getters) expect(get).not.toHaveBeenCalled();
    expect(f.dependencies.persist).not.toHaveBeenCalled();
    expect(f.dependencies.reap).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "suppresses reap after release while persistence settles (reject=%s)",
    async (reject) => {
      const f = fixture();
      const owner = ownHarnessUnloadSubscription(f.dependencies);
      f.dispatch();
      owner.release();
      const replacement = fixture();
      const nextOwner = ownHarnessUnloadSubscription(replacement.dependencies);
      if (reject) f.pending.reject(new Error("persist failed"));
      else f.pending.resolve();
      await settle();
      expect(f.dependencies.reap).not.toHaveBeenCalled();
      expect(replacement.dependencies.reap).not.toHaveBeenCalled();
      nextOwner.release();
    },
  );

  it("preserves finally policy on persistence rejection for an active owner", async () => {
    const f = fixture();
    const owner = ownHarnessUnloadSubscription(f.dependencies);
    f.dispatch();
    f.pending.reject(new Error("persist failed"));
    await settle();
    expect(f.dependencies.reap).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.dependencies.reap).mock.calls[0][0]).toBe(
      vi.mocked(f.dependencies.persist).mock.calls[0][0],
    );
    owner.release();
  });

  it.each(["flush", "getProjectReturnMemory"] as const)(
    "does not persist or reap when %s throws",
    async (name) => {
      const f = fixture();
      vi.mocked(f.dependencies[name]).mockImplementation(() => {
        throw new Error("capture failed");
      });
      const owner = ownHarnessUnloadSubscription(f.dependencies);
      expect(() => f.dispatch()).not.toThrow();
      f.dispatch("beforeunload");
      await settle();
      expect(f.dependencies.flush).toHaveBeenCalledTimes(1);
      expect(f.dependencies.persist).not.toHaveBeenCalled();
      expect(f.dependencies.reap).not.toHaveBeenCalled();
      owner.release();
    },
  );

  it.each(["persist", "reap"] as const)(
    "handles synchronous %s errors without unhandled rejection",
    async (name) => {
      const f = fixture();
      vi.mocked(f.dependencies[name]).mockImplementation(() => {
        throw new Error(name);
      });
      const owner = ownHarnessUnloadSubscription(f.dependencies);
      expect(() => f.dispatch()).not.toThrow();
      f.pending.resolve();
      await settle();
      expect(f.dependencies.reap).toHaveBeenCalledTimes(1);
      owner.release();
    },
  );

  it("handles asynchronous reap rejection", async () => {
    const f = fixture();
    vi.mocked(f.dependencies.reap).mockRejectedValue(new Error("reap failed"));
    const owner = ownHarnessUnloadSubscription(f.dependencies);
    f.dispatch();
    f.pending.resolve();
    await settle();
    expect(f.dependencies.reap).toHaveBeenCalledTimes(1);
    owner.release();
  });

  it("skips app quit without flush or capture and permits a later unload", async () => {
    const f = fixture();
    vi.mocked(f.dependencies.isAppQuitting).mockReturnValue(true);
    const owner = ownHarnessUnloadSubscription(f.dependencies);
    f.dispatch();
    expect(f.dependencies.flush).not.toHaveBeenCalled();
    for (const get of f.getters) expect(get).not.toHaveBeenCalled();
    vi.mocked(f.dependencies.isAppQuitting).mockReturnValue(false);
    f.dispatch("beforeunload");
    expect(f.dependencies.persist).toHaveBeenCalledTimes(1);
    f.pending.resolve();
    await settle();
    owner.release();
  });
});
