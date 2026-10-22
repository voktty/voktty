import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectWorkspaceSnapshot } from "@/modules/harness/lib/workspaceSnapshot";
import { newTab } from "@/modules/harness/lib/layout";
import { newSession, type Session } from "@/modules/harness/lib/session";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";

const store = vi.hoisted(() => ({
  getSession: vi.fn(),
  listInFlightSessions: vi.fn(),
  loadWorkspaceSnapshot: vi.fn(),
  replaceInFlightSessions: vi.fn(),
  saveWorkspaceSnapshot: vi.fn(),
  upsertSessions: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/harness/lib/sessionStore", () => store);
vi.mock("@/modules/harness/lib/windowTransferBootstrap", () => ({
  loadWindowTransfer: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/harness/lib/fs", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/fs")>()),
  restoreSessionCheckout: vi.fn(async (session: Session) => session),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function workspace() {
  const session = newSession("cursor", "/work/project");
  session.busy = true;
  session.title = "Captured";
  session.modelSettings = { thinking: "high" };
  session.blocks = [{ id: "user", role: "user", text: "continue" }];
  const tab = newTab(session.id);
  const dock: ProjectTerminalDock = {
    projectPath: session.cwd,
    pane: {
      id: "dock",
      activeFileId: "terminal",
      files: [
        { id: "terminal", path: "Terminal", cwd: session.cwd, terminal: true },
      ],
    },
    side: "bottom",
    size: 240,
    open: true,
  };
  return {
    sessions: [session],
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: session.cwd,
    memory: new Map([[session.cwd, session.id]]),
    docks: [dock],
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const mock of Object.values(store)) mock.mockReset();
  store.getSession.mockResolvedValue(null);
  store.listInFlightSessions.mockResolvedValue([]);
  store.loadWorkspaceSnapshot.mockResolvedValue(null);
  store.replaceInFlightSessions.mockResolvedValue(undefined);
  store.saveWorkspaceSnapshot.mockResolvedValue(undefined);
  store.upsertSessions.mockResolvedValue([]);
});

describe("lifecycle persistence capture before transcript settlement", () => {
  it.each(["resolve", "reject"] as const)(
    "retains the transcript attempt when retention fails and its write %ss",
    async (outcome) => {
      const state = workspace();
      const failure = new Error("retention failed");
      const gate = deferred<[]>();
      const { persistQuitState } = await import(
        "@/modules/harness/lib/appLifecycle"
      );
      store.upsertSessions.mockReturnValueOnce(gate.promise);
      const writing = persistQuitState(
        state.sessions,
        state.tabs,
        state.activeTabId,
        state.projectCwd,
        state.memory,
        "quit",
        state.docks,
        () => {
          throw failure;
        },
      );
      const observed = writing.catch((error: unknown) => error);
      let settled = false;
      void observed.then(() => {
        settled = true;
      });
      expect(store.upsertSessions).toHaveBeenCalledOnce();
      await Promise.resolve();
      expect(settled).toBe(false);
      if (outcome === "resolve") gate.resolve([]);
      else gate.reject(new Error("transcript failed"));
      expect(await observed).toBe(failure);
      expect(store.saveWorkspaceSnapshot).not.toHaveBeenCalled();
      expect(store.replaceInFlightSessions).not.toHaveBeenCalled();
    },
  );
  it.each(["quit", "unload"] as const)(
    "seals keep-tab policy before the %s transcript write",
    async (mode) => {
      const state = workspace();
      const gate = deferred<[]>();
      const { persistQuitState } = await import(
        "@/modules/harness/lib/appLifecycle"
      );
      let keep = true;
      const policy = vi.fn(() => keep);
      store.upsertSessions.mockReturnValueOnce(gate.promise);
      const writing = persistQuitState(
        state.sessions,
        state.tabs,
        state.activeTabId,
        state.projectCwd,
        state.memory,
        mode,
        state.docks,
        policy,
      );
      expect(store.upsertSessions).toHaveBeenCalledOnce();
      keep = false;
      gate.resolve([]);
      await writing;
      expect(store.saveWorkspaceSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          tabs: state.tabs,
          sessions: [expect.objectContaining({ id: state.sessions[0].id })],
        }),
      );
      expect(policy).toHaveBeenCalledTimes(1);
    },
  );

  it("captures tab, session, return-memory and dock data before transcript completion", async () => {
    const state = workspace();
    const expected = collectWorkspaceSnapshot(
      state.tabs,
      state.sessions,
      state.activeTabId,
      state.projectCwd,
      state.memory,
      state.docks,
    );
    const gate = deferred<[]>();
    const { persistQuitState } = await import(
      "@/modules/harness/lib/appLifecycle"
    );
    store.upsertSessions.mockReturnValueOnce(gate.promise);
    const writing = persistQuitState(
      state.sessions,
      state.tabs,
      state.activeTabId,
      state.projectCwd,
      state.memory,
      "quit",
      state.docks,
    );
    state.sessions[0].title = "Later";
    state.sessions[0].modelSettings.thinking = "low";
    state.tabs[0].focusedId = "later-pane";
    state.memory.clear();
    state.docks[0].pane.files[0].path = "Later terminal";
    state.docks[0].open = false;
    gate.resolve([]);
    await writing;
    expect(store.saveWorkspaceSnapshot).toHaveBeenCalledWith(expected);
    expect(store.replaceInFlightSessions).toHaveBeenCalledWith([
      { sessionId: expected.sessions[0].id, cwd: state.projectCwd },
    ]);
  });

  it("evaluates retention before starting any transcript persistence", async () => {
    const state = workspace();
    const { persistQuitState } = await import(
      "@/modules/harness/lib/appLifecycle"
    );
    const order: string[] = [];
    store.upsertSessions.mockImplementationOnce(async () => {
      order.push("transcript");
      return [];
    });
    await persistQuitState(
      state.sessions,
      state.tabs,
      state.activeTabId,
      state.projectCwd,
      state.memory,
      "quit",
      state.docks,
      () => {
        order.push("retention");
        return true;
      },
    );
    expect(order).toEqual(["retention", "transcript"]);
  });

  it("still persists snapshot and recovery refs when transcript writing rejects", async () => {
    const state = workspace();
    const { persistQuitState } = await import(
      "@/modules/harness/lib/appLifecycle"
    );
    store.upsertSessions.mockRejectedValueOnce(new Error("disk failed"));
    await persistQuitState(
      state.sessions,
      state.tabs,
      state.activeTabId,
      state.projectCwd,
      state.memory,
      "quit",
      state.docks,
    );
    expect(store.saveWorkspaceSnapshot).toHaveBeenCalledOnce();
    expect(store.replaceInFlightSessions).toHaveBeenCalledWith([
      { sessionId: state.sessions[0].id, cwd: state.projectCwd },
    ]);
  });

  it("keeps unload's idle recovery refs untouched", async () => {
    const state = workspace();
    state.sessions[0].busy = false;
    const { persistQuitState } = await import(
      "@/modules/harness/lib/appLifecycle"
    );
    await persistQuitState(
      state.sessions,
      state.tabs,
      state.activeTabId,
      state.projectCwd,
      state.memory,
      "unload",
      state.docks,
    );
    expect(store.saveWorkspaceSnapshot).toHaveBeenCalledOnce();
    expect(store.replaceInFlightSessions).not.toHaveBeenCalled();
  });

  it.each(["snapshot", "recovery"] as const)(
    "captures boot %s before its transcript write",
    async (kind) => {
      const state = workspace();
      store.loadWorkspaceSnapshot.mockResolvedValue(
        collectWorkspaceSnapshot(
          state.tabs,
          state.sessions,
          state.activeTabId,
          state.projectCwd,
          state.memory,
          state.docks,
        ),
      );
      store.getSession.mockResolvedValue(state.sessions[0]);
      store.listInFlightSessions.mockResolvedValue([
        { sessionId: state.sessions[0].id, cwd: state.projectCwd },
      ]);
      const { loadBootWorkspace, commitQuit } = await import(
        "@/modules/harness/lib/appLifecycle"
      );
      const { resumed } = await loadBootWorkspace();
      if (!resumed) throw new Error("Expected restored workspace");
      const expected = collectWorkspaceSnapshot(
        resumed.tabs,
        resumed.sessions,
        resumed.activeTabId,
        resumed.projectCwd,
        resumed.projectReturnMemory ?? new Map(),
        resumed.projectTerminals,
      );
      const originalId = resumed.sessions[0].id;
      const originalCwd = resumed.sessions[0].cwd;
      const gate = deferred<[]>();
      store.upsertSessions.mockReturnValueOnce(gate.promise);
      const writing = commitQuit(42);
      await vi.waitFor(() =>
        expect(store.upsertSessions).toHaveBeenCalledTimes(2),
      );
      resumed.sessions[0] = {
        ...resumed.sessions[0],
        ...(kind === "snapshot" ? { cwd: "/work/later", title: "Later" } : {}),
        blocks: [{ id: "later", role: "user", text: "later turn" }],
      };
      if (kind === "snapshot") resumed.tabs[0].focusedId = "later-pane";
      gate.resolve([]);
      await writing;
      expect(store.saveWorkspaceSnapshot).toHaveBeenCalledWith(expected);
      expect(store.replaceInFlightSessions).toHaveBeenCalledWith([
        { sessionId: originalId, cwd: originalCwd },
      ]);
    },
  );
});
