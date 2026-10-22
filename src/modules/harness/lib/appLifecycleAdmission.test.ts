import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPersistenceAdmission,
  type PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import { newTab } from "@/modules/harness/lib/layout";

const native = vi.hoisted(() => ({ invoke: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: native.ask }));

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Expected persistence test fixture value to be present");
  }
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function workspace(busy = false) {
  const session = newSession("cursor", "/work/project");
  session.busy = busy;
  session.blocks = [{ id: "user", role: "user", text: "continue" }];
  const tabs = [newTab(session.id)];
  return {
    sessions: [session],
    tabs,
    activeTabId: tabs[0].id,
    projectCwd: session.cwd,
    projectReturnMemory: new Map(),
    projectTerminals: [],
  };
}

let lifecycle: typeof import("@/modules/harness/lib/appLifecycle");

beforeEach(async () => {
  vi.resetModules();
  native.invoke.mockReset().mockResolvedValue([]);
  native.ask.mockReset().mockResolvedValue(true);
  lifecycle = await import("@/modules/harness/lib/appLifecycle");
});

function close(state: ReturnType<typeof workspace>, permit: PersistencePermit) {
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

describe("final lifecycle admission with real persistence FIFOs", () => {
  it("native destroy rejection rearms its exact final and preserves the error", async () => {
    const authority = createPersistenceAdmission();
    const resume = vi.fn();
    const owner = authority.createOwner(resume);
    const stale = required(owner.capture());
    const failure = new Error("destroy failed");
    native.invoke.mockImplementation((command: string) =>
      command === "destroy_window"
        ? Promise.reject(failure)
        : Promise.resolve([]),
    );
    await expect(close(workspace(), required(owner.capture()))).rejects.toBe(
      failure,
    );
    expect(resume).toHaveBeenCalledOnce();
    expect(stale.isCurrent()).toBe(false);
    expect(owner.capture()).not.toBeNull();
  });
  it("seals all publishers before the first transcript await", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const other = authority.createOwner();
    const gate = deferred<[]>();
    native.invoke.mockImplementation((command: string) =>
      command === "session_upsert_batch" ? gate.promise : Promise.resolve([]),
    );
    const writing = close(workspace(), required(owner.capture()));
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "session_upsert_batch",
        expect.anything(),
      ),
    );
    const blocked = other.capture() === null;
    gate.resolve([]);
    await writing;
    expect(blocked).toBe(true);
  });

  it("does not let a delayed sibling snapshot overwrite the final capture", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const timerPermit = required(authority.createOwner().capture());
    const { saveWorkspaceSnapshot } = await import(
      "@/modules/harness/lib/sessionStore"
    );
    await close(workspace(), required(owner.capture()));
    await timerPermit.run(() => saveWorkspaceSnapshot({ marker: "stale" }));
    const snapshots = native.invoke.mock.calls.filter(
      ([command]) => command === "workspace_set_snapshot",
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0][1].snapshot.projectCwd).toBe("/work/project");
  });

  it.each(["resolve", "reject"] as const)(
    "waits for an admitted snapshot to %s before final transcript issuance",
    async (outcome) => {
      const authority = createPersistenceAdmission();
      const owner = authority.createOwner();
      const other = authority.createOwner();
      const gate = deferred<[]>();
      native.invoke.mockImplementationOnce(() => gate.promise);
      const { saveWorkspaceSnapshot } = await import(
        "@/modules/harness/lib/sessionStore"
      );
      const prior = required(other.capture())
        .run(() => saveWorkspaceSnapshot({ marker: "prior" }))
        .catch((error: unknown) => error);
      await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
      const writing = close(workspace(), required(owner.capture()));
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const issuedEarly = native.invoke.mock.calls.some(
        ([command]) => command === "session_upsert_batch",
      );
      if (outcome === "resolve") gate.resolve([]);
      else gate.reject(new Error("snapshot failed"));
      await Promise.all([prior, writing]);
      expect(issuedEarly).toBe(false);
      expect(native.invoke).toHaveBeenCalledWith("destroy_window");
    },
  );

  it("keeps an unconfirmed close open without invalidating its timer permit", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const permit = required(owner.capture());
    native.ask.mockResolvedValueOnce(false);
    await close(workspace(true), permit);
    expect(permit.isCurrent()).toBe(true);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("retired close ownership cannot persist later phases or destroy a replacement", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const gate = deferred<[]>();
    native.invoke.mockImplementation((command: string) =>
      command === "session_upsert_batch" ? gate.promise : Promise.resolve([]),
    );
    const writing = close(workspace(), required(owner.capture()));
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "session_upsert_batch",
        expect.anything(),
      ),
    );
    owner.retire();
    gate.resolve([]);
    await writing;
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert_batch",
    ]);
  });

  it("abort rearms current publishers and suppresses old quit continuations", async () => {
    const authority = createPersistenceAdmission();
    const resumed = vi.fn();
    const owner = authority.createOwner(resumed);
    const state = workspace();
    const gate = deferred<[]>();
    const { setQuitWorkspace, commitQuit, abortQuit } = await import(
      "@/modules/harness/lib/appLifecycle"
    );
    const release = setQuitWorkspace(
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
    native.invoke.mockImplementation((command: string) =>
      command === "session_upsert_batch" ? gate.promise : Promise.resolve([]),
    );
    const writing = commitQuit(42);
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "session_upsert_batch",
        expect.anything(),
      ),
    );
    abortQuit();
    gate.resolve([]);
    await writing;
    release();
    expect(resumed).toHaveBeenCalledOnce();
    expect(owner.capture()).not.toBeNull();
    expect(native.invoke).not.toHaveBeenCalledWith(
      "workspace_set_snapshot",
      expect.anything(),
    );
    expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 42,
      persisted: false,
    });
  });
});
