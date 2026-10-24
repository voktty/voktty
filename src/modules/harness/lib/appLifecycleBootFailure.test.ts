import { beforeEach, expect, it, vi } from "vitest";
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
vi.mock("@/modules/harness/lib/windowTransferBootstrap", () => ({
  loadWindowTransfer: async () => null,
}));
vi.mock("@/modules/harness/lib/fs", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/fs")>()),
  restoreSessionCheckout: async (session: Session) => session,
}));
beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(store)) mock.mockReset();
  native.invoke.mockReset().mockResolvedValue(undefined);
  store.loadWorkspaceSnapshot.mockResolvedValue(null);
  store.upsertSessions.mockResolvedValue([]);
  store.saveWorkspaceSnapshot.mockResolvedValue(undefined);
  store.replaceInFlightSessions.mockResolvedValue(undefined);
  const session = newSession("cursor", "/work/project");
  session.blocks = [{ id: "user", role: "user", text: "continue" }];
  store.getSession.mockResolvedValue(session);
  store.listInFlightSessions.mockResolvedValue([
    { sessionId: session.id, cwd: session.cwd },
  ]);
});
it.each([
  "upsertSessions",
  "saveWorkspaceSnapshot",
  "replaceInFlightSessions",
] as const)(
  "does not acknowledge a successful boot quit after %s rejects",
  async (name) => {
    const lifecycle = await import("@/modules/harness/lib/appLifecycle");
    const { windowPersistenceAdmission } = await import(
      "@/modules/harness/lib/persistenceAdmission"
    );
    await lifecycle.loadBootWorkspace();
    store[name].mockRejectedValueOnce(new Error("disk full"));
    await lifecycle.commitQuit(50);
    expect(native.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 50,
      persisted: false,
    });
    expect(native.invoke).not.toHaveBeenCalledWith("confirm_quit");
    lifecycle.abortQuit();
    const owner = windowPersistenceAdmission.createOwner();
    expect(owner.capture()).not.toBeNull();
    owner.retire();
  },
);
