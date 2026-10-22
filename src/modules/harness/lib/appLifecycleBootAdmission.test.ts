import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "@/modules/harness/lib/session";

const store = vi.hoisted(() => ({
  getSession: vi.fn(),
  listInFlightSessions: vi.fn(),
  loadWorkspaceSnapshot: vi.fn(),
  replaceInFlightSessions: vi.fn(),
  saveWorkspaceSnapshot: vi.fn(),
  upsertSessions: vi.fn(),
}));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@/modules/harness/lib/sessionStore", () => store);
vi.mock("@/modules/harness/lib/fs", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/fs")>()),
  restoreSessionCheckout: vi.fn(async (session: Session) => session),
}));

function deferred<T = []>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(store)) mock.mockReset();
  native.invoke.mockReset().mockResolvedValue(undefined);
  store.loadWorkspaceSnapshot.mockResolvedValue(null);
  store.saveWorkspaceSnapshot.mockResolvedValue(undefined);
  store.replaceInFlightSessions.mockResolvedValue(undefined);
  store.upsertSessions.mockResolvedValue([]);
  const session = newSession("cursor", "/work/project");
  session.blocks = [{ id: "user", role: "user", text: "continue" }];
  store.getSession.mockResolvedValue(session);
  store.listInFlightSessions.mockResolvedValue([
    { sessionId: session.id, cwd: session.cwd },
  ]);
});

async function boot() {
  const lifecycle = await import("@/modules/harness/lib/appLifecycle");
  const { windowPersistenceAdmission } = await import(
    "@/modules/harness/lib/persistenceAdmission"
  );
  await lifecycle.loadBootWorkspace();
  return { lifecycle, authority: windowPersistenceAdmission };
}

describe("bootstrap final persistence admission", () => {
  it.each(["commit", "legacy"] as const)(
    "does not revive an aborted %s from a cached boot promise",
    async (mode) => {
      const { lifecycle, authority } = await boot();
      const writing =
        mode === "commit"
          ? lifecycle.commitQuit(44)
          : lifecycle.handleQuitRequested();
      lifecycle.abortQuit();
      await writing;
      expect(store.upsertSessions).toHaveBeenCalledOnce();
      expect(store.saveWorkspaceSnapshot).not.toHaveBeenCalled();
      expect(store.replaceInFlightSessions).not.toHaveBeenCalled();
      if (mode === "commit")
        expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
          id: 44,
          persisted: false,
        });
      else expect(native.invoke).not.toHaveBeenCalledWith("confirm_quit");
      const owner = authority.createOwner();
      expect(owner.capture()).not.toBeNull();
      lifecycle.abortQuit();
      owner.retire();
    },
  );

  it.each(["commit", "legacy"] as const)(
    "does not revive an aborted %s after deferred boot loading",
    async (mode) => {
      const lifecycle = await import("@/modules/harness/lib/appLifecycle");
      const refs: { sessionId: string; cwd: string }[] =
        await store.listInFlightSessions();
      store.listInFlightSessions.mockClear();
      const gate = deferred<typeof refs>();
      store.listInFlightSessions.mockReturnValueOnce(gate.promise);
      const writing =
        mode === "commit"
          ? lifecycle.commitQuit(45)
          : lifecycle.handleQuitRequested();
      await vi.waitFor(() =>
        expect(store.listInFlightSessions).toHaveBeenCalledOnce(),
      );
      lifecycle.abortQuit();
      gate.resolve(refs);
      await writing;
      expect(store.upsertSessions).toHaveBeenCalledOnce();
      expect(store.saveWorkspaceSnapshot).not.toHaveBeenCalled();
      expect(store.replaceInFlightSessions).not.toHaveBeenCalled();
      if (mode === "commit")
        expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
          id: 45,
          persisted: false,
        });
      else expect(native.invoke).not.toHaveBeenCalledWith("confirm_quit");
      lifecycle.abortQuit();
    },
  );

  it("an aborted cold-boot quit cannot steal a replacement request's seal", async () => {
    const lifecycle = await import("@/modules/harness/lib/appLifecycle");
    const refs: { sessionId: string; cwd: string }[] =
      await store.listInFlightSessions();
    store.listInFlightSessions.mockClear();
    const gate = deferred<typeof refs>();
    store.listInFlightSessions.mockReturnValueOnce(gate.promise);
    const old = lifecycle.commitQuit(51);
    await vi.waitFor(() =>
      expect(store.listInFlightSessions).toHaveBeenCalledOnce(),
    );
    lifecycle.abortQuit();
    const current = lifecycle.commitQuit(52);
    gate.resolve(refs);
    await Promise.all([old, current]);
    expect(store.upsertSessions).toHaveBeenCalledTimes(2);
    expect(store.saveWorkspaceSnapshot).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 51,
      persisted: false,
    });
    expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 52,
      persisted: true,
    });
    lifecycle.abortQuit();
  });
  it("blocks a publisher mounted while native boot quit waits for transcripts", async () => {
    const { lifecycle, authority } = await boot();
    const gate = deferred();
    store.upsertSessions.mockReturnValueOnce(gate.promise);
    const writing = lifecycle.commitQuit(42);
    await vi.waitFor(() =>
      expect(store.upsertSessions).toHaveBeenCalledTimes(2),
    );
    const late = authority.createOwner();
    const blocked = late.capture() === null;
    gate.resolve([]);
    await writing;
    expect(blocked).toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 42,
      persisted: true,
    });
    lifecycle.abortQuit();
    late.retire();
  });

  it("abort during bootstrap write rearms publishers and suppresses old phases", async () => {
    const { lifecycle, authority } = await boot();
    const resume = vi.fn();
    const owner = authority.createOwner(resume);
    const gate = deferred();
    store.upsertSessions.mockReturnValueOnce(gate.promise);
    const writing = lifecycle.commitQuit(43);
    await vi.waitFor(() =>
      expect(store.upsertSessions).toHaveBeenCalledTimes(2),
    );
    lifecycle.abortQuit();
    gate.resolve([]);
    await writing;
    expect(resume).toHaveBeenCalledOnce();
    expect(owner.capture()).not.toBeNull();
    expect(store.saveWorkspaceSnapshot).not.toHaveBeenCalled();
    expect(store.replaceInFlightSessions).not.toHaveBeenCalled();
    expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 43,
      persisted: false,
    });
    owner.retire();
  });

  it("legacy bootstrap quit also seals the shared authority", async () => {
    const { lifecycle, authority } = await boot();
    await lifecycle.handleQuitRequested();
    const owner = authority.createOwner();
    expect(owner.capture()).toBeNull();
    expect(native.invoke).toHaveBeenCalledWith("confirm_quit");
    lifecycle.abortQuit();
    owner.retire();
  });
});
