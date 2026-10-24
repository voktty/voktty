import { beforeEach, expect, it, vi } from "vitest";
import {
  createPersistenceAdmission,
  type PersistenceOwner,
} from "@/modules/harness/lib/persistenceAdmission";
import { newTab } from "@/modules/harness/lib/layout";
import { newSession } from "@/modules/harness/lib/session";

const native = vi.hoisted(() => ({ invoke: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: native.ask }));
let lifecycle: typeof import("@/modules/harness/lib/appLifecycle");
beforeEach(async () => {
  vi.resetModules();
  native.invoke.mockReset().mockResolvedValue([]);
  native.ask.mockReset().mockResolvedValue(true);
  lifecycle = await import("@/modules/harness/lib/appLifecycle");
});

function fixture() {
  const session = newSession("cursor", "/work/project");
  session.busy = true;
  session.blocks = [{ id: "user", role: "user", text: "continue" }];
  const tabs = [newTab(session.id)];
  return {
    sessions: [session],
    tabs,
    activeTabId: tabs[0].id,
    projectCwd: session.cwd,
    projectReturnMemory: new Map<string, string>(),
    projectTerminals: [],
  };
}
async function close(owner: PersistenceOwner) {
  const state = fixture();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing test permit.");
  return lifecycle.confirmAndCloseWindow(
    state.sessions,
    state.tabs,
    state.activeTabId,
    state.projectCwd,
    state.projectReturnMemory,
    [],
    undefined,
    undefined,
    () => ({ ...state, persistencePermit: permit }),
  );
}

it.each([
  "session_upsert_batch",
  "workspace_set_snapshot",
  "session_set_in_flight",
])(
  "keeps the window open and rearms admission after %s fails",
  async (command) => {
    const authority = createPersistenceAdmission();
    const resumed = vi.fn();
    const owner = authority.createOwner(resumed);
    const stale = owner.capture();
    const failure = new Error("final write failed");
    let fail = true;
    native.invoke.mockImplementation(async (name: string) => {
      if (name === command && fail) throw failure;
      return [];
    });
    await expect(close(owner)).rejects.toBe(failure);
    expect(native.invoke).not.toHaveBeenCalledWith("destroy_window");
    expect(native.invoke).toHaveBeenCalledWith(
      "workspace_set_snapshot",
      expect.anything(),
    );
    expect(native.invoke).toHaveBeenCalledWith(
      "session_set_in_flight",
      expect.anything(),
    );
    expect(resumed).toHaveBeenCalledOnce();
    expect(stale?.isCurrent()).toBe(false);
    expect(owner.capture()).not.toBeNull();
    fail = false;
    await close(owner);
    expect(native.invoke).toHaveBeenCalledWith("destroy_window");
    owner.retire();
  },
);

it("reports an unsuccessful coordinated quit instead of acknowledging a failed final snapshot", async () => {
  const state = fixture();
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const release = lifecycle.setQuitWorkspace(
    () => state.sessions,
    () => state.tabs,
    () => state.activeTabId,
    () => state.projectCwd,
    () => [],
    () => state.projectReturnMemory,
    () => {},
    undefined,
    owner,
  );
  native.invoke.mockImplementation(async (name: string) => {
    if (name === "workspace_set_snapshot") throw new Error("disk full");
    return [];
  });
  try {
    await lifecycle.commitQuit(42);
    expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 42,
      persisted: false,
    });
    expect(native.invoke).not.toHaveBeenCalledWith("destroy_window");
    lifecycle.abortQuit();
    expect(owner.capture()).not.toBeNull();
  } finally {
    release();
    owner.retire();
  }
});

it("preserves best-effort unload writes outside final admission", async () => {
  const state = fixture();
  native.invoke.mockImplementation(async (name: string) => {
    if (name === "session_upsert_batch") throw new Error("disk full");
    return [];
  });
  await lifecycle.persistQuitState(
    state.sessions,
    state.tabs,
    state.activeTabId,
    state.projectCwd,
    state.projectReturnMemory,
    "unload",
  );
  expect(native.invoke).toHaveBeenCalledWith(
    "workspace_set_snapshot",
    expect.anything(),
  );
  expect(native.invoke).toHaveBeenCalledWith(
    "session_set_in_flight",
    expect.anything(),
  );
});

it("refuses to destroy the window when a current final writer declines admission", async () => {
  const owner = createPersistenceAdmission().createOwner();
  const refusing: PersistenceOwner = {
    retire: owner.retire,
    capture: () => {
      const permit = owner.capture();
      return permit
        ? {
            ...permit,
            seal: () => {
              const final = permit.seal();
              return final ? { ...final, run: async () => false } : null;
            },
          }
        : null;
    },
  };
  await expect(close(refusing)).rejects.toThrow("not admitted");
  expect(native.invoke).not.toHaveBeenCalled();
  expect(owner.capture()).not.toBeNull();
  owner.retire();
});

it("preserves the first final failure while attempting the remaining recovery writes", async () => {
  const owner = createPersistenceAdmission().createOwner();
  const first = new Error("transcript failed");
  native.invoke.mockImplementation(async (name: string) => {
    if (name === "session_upsert_batch") throw first;
    throw new Error("later write failed");
  });
  await expect(close(owner)).rejects.toBe(first);
  expect(native.invoke).toHaveBeenCalledWith(
    "workspace_set_snapshot",
    expect.anything(),
  );
  expect(native.invoke).toHaveBeenCalledWith(
    "session_set_in_flight",
    expect.anything(),
  );
  expect(native.invoke).not.toHaveBeenCalledWith("destroy_window");
  owner.retire();
});

it.each([false, true])(
  "observes final failure only while its controller is current (retired=%s)",
  async (retire) => {
    const { ownHarnessWindowPersistence } = await import(
      "@/modules/harness/lib/harnessWindowPersistence"
    );
    const state = fixture();
    const owner = createPersistenceAdmission().createOwner();
    const onError = vi.fn();
    let listener: (event: { preventDefault: () => void }) => void = () => {};
    let rejectWrite: (error: Error) => void = () => {};
    const pending = new Promise<never>((_resolve, reject) => {
      rejectWrite = reject;
    });
    native.invoke.mockImplementation(async (name: string) => {
      if (name === "workspace_set_snapshot") return pending;
      return [];
    });
    const controller = ownHarnessWindowPersistence({
      owner,
      read: () => state,
      flush: () => {},
      skipSnapshot: () => true,
      closeToTray: () => false,
      onError,
      target: new EventTarget(),
      registerClose: async (callback) => {
        listener = callback;
        return () => {};
      },
      schedule: () => () => {},
    });
    try {
      await controller.ready;
      listener({ preventDefault: vi.fn() });
      await vi.waitFor(() =>
        expect(native.invoke).toHaveBeenCalledWith(
          "workspace_set_snapshot",
          expect.anything(),
        ),
      );
      if (retire) controller.release();
      const failure = new Error("snapshot failed");
      rejectWrite(failure);
      if (retire) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(onError).not.toHaveBeenCalled();
      } else
        await vi.waitFor(() =>
          expect(onError).toHaveBeenCalledExactlyOnceWith(failure),
        );
      expect(native.invoke).not.toHaveBeenCalledWith("destroy_window");
    } finally {
      controller.release();
      owner.retire();
    }
  },
);
