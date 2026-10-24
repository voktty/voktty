// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { newSession, type Session } from "@/modules/harness/lib/session";
import { newTab } from "@/modules/harness/lib/layout";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import type { WindowCloseCapture } from "@/modules/lifecycle/windowCloseParticipants";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  available: true,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/harness/lib/remoteSessionIo", () => ({
  remoteStoreIoFor: () =>
    io.available
      ? {
          key: "saved-project",
          environmentId: "voktty-ssh-final",
          root: "/srv/project",
          io: {
            read: io.read,
            write: io.write,
            list: async () => [],
            remove: async () => {},
          },
        }
      : undefined,
}));

let store: typeof import("@/modules/harness/lib/sessionStore");
let lifecycle: typeof import("@/modules/harness/lib/appLifecycle");
let ownHarnessWindowPersistence: typeof import("@/modules/harness/lib/harnessWindowPersistence").ownHarnessWindowPersistence;
const cwd = "remote://voktty-ssh-final/srv/project";
const strict = { requireRemotePersistence: true };
function session(id: string, path = cwd): Session {
  return {
    ...newSession("cursor", path),
    id,
    blocks: [{ id: "user", role: "user", text: "continue" }],
    busy: true,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-final", {
    id: "final-project",
    name: "project",
    cwd: "/srv/project",
  });
  io.available = true;
  io.write.mockReset().mockResolvedValue(undefined);
  io.read.mockReset().mockResolvedValue(null);
  io.invoke.mockReset().mockResolvedValue([]);
  store = await import("@/modules/harness/lib/sessionStore");
  lifecycle = await import("@/modules/harness/lib/appLifecycle");
  ({ ownHarnessWindowPersistence } = await import(
    "@/modules/harness/lib/harnessWindowPersistence"
  ));
});

it("preserves best-effort remote batches outside final persistence", async () => {
  io.write.mockRejectedValue(new Error("remote unavailable"));
  expect(await store.upsertSessions([session("periodic")])).toEqual([]);
});

it("waits for remote siblings and local writes before rejecting the original remote failure", async () => {
  const failure = new Error("remote write failed");
  const remote = deferred<void>();
  const local = deferred<unknown[]>();
  io.write.mockImplementation(async (path: string) => {
    if (path.endsWith("failed.json")) throw failure;
    if (path.endsWith("pending.json")) await remote.promise;
  });
  io.invoke.mockReturnValue(local.promise);
  let settled = false;
  const batch = store.upsertSessions(
    [session("failed"), session("pending"), session("local", "/work/project")],
    strict,
  );
  const observed = expect(batch).rejects.toBe(failure);
  void batch.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.waitFor(() =>
    expect(io.write).toHaveBeenCalledWith(
      ".voktty/sessions/pending.json",
      expect.any(String),
    ),
  );
  expect(settled).toBe(false);
  remote.resolve();
  await vi.waitFor(() =>
    expect(io.write).toHaveBeenCalledWith(
      ".voktty/sessions/pending.meta.json",
      expect.any(String),
    ),
  );
  expect(settled).toBe(false);
  local.resolve([]);
  await observed;
  expect(io.invoke).toHaveBeenCalledExactlyOnceWith(
    "session_upsert_batch",
    expect.objectContaining({
      sessions: [
        expect.objectContaining({ id: "local", cwd: "/work/project" }),
      ],
    }),
  );
});

it("refuses an unsaved remote project while still saving eligible local sessions", async () => {
  await expect(
    store.upsertSessions(
      [
        session("unsaved", "remote://voktty-ssh-final/elsewhere"),
        session("local", "/work/project"),
      ],
      strict,
    ),
  ).rejects.toThrow("Remote project is unavailable");
  expect(io.write).not.toHaveBeenCalled();
  expect(io.invoke).toHaveBeenCalledWith("session_upsert_batch", {
    sessions: [expect.objectContaining({ id: "local" })],
  });
});

it("refuses final persistence when the saved remote project's IO cannot be resolved", async () => {
  io.available = false;
  await expect(
    store.upsertSessions([session("unavailable")], strict),
  ).rejects.toThrow("Remote project is unavailable");
  expect(io.invoke).not.toHaveBeenCalled();
});

it("rejects a batch containing only a remote conversation outside saved projects", async () => {
  await expect(
    store.upsertSessions(
      [session("unsaved-only", "remote://voktty-ssh-final/elsewhere")],
      strict,
    ),
  ).rejects.toThrow("Remote project is unavailable");
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
});

it("does not require a remote save for blank or ephemeral conversations", async () => {
  const blank = {
    ...session("blank", "remote://voktty-ssh-final/elsewhere"),
    blocks: [],
  };
  expect(await store.upsertSessions([blank], strict)).toEqual([]);
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
});

it("reports failed boot-time final persistence through the quit acknowledgement", async () => {
  const source = { ...session("boot"), harness: "claude" as const };
  const tab = newTab(source.id);
  io.read.mockImplementation(async (path: string) =>
    path.endsWith("/boot.json")
      ? JSON.stringify({
          ...source,
          cwd: "/srv/project",
          createdAt: 1,
          updatedAt: 1,
        })
      : null,
  );
  io.invoke.mockImplementation(async (command: string) => {
    if (command === "workspace_get_snapshot")
      return {
        tabs: [tab],
        sessions: [source],
        activeTabId: tab.id,
        projectCwd: cwd,
        projectTerminals: [],
      };
    if (command === "session_list_in_flight") return [];
    if (command === "session_get")
      return { ...source, createdAt: 1, updatedAt: 1 };
    return undefined;
  });
  io.write.mockRejectedValue(new Error("remote unavailable"));
  try {
    await lifecycle.commitQuit(108);
    expect(io.write).toHaveBeenCalled();
    expect(io.invoke).toHaveBeenCalledWith("quit_ready", {
      id: 108,
      persisted: false,
    });
    expect(io.invoke).not.toHaveBeenCalledWith("confirm_quit");
  } finally {
    lifecycle.abortQuit();
  }
});

it.each(["integrated.json", "integrated.meta.json"])(
  "keeps the integrated close open after %s fails and permits an explicit retry",
  async (file) => {
    const source = session("integrated");
    const tab = newTab(source.id);
    const owner = createPersistenceAdmission().createOwner();
    let capture!: () => WindowCloseCapture;
    const controller = ownHarnessWindowPersistence({
      owner,
      read: () => ({
        sessions: [source],
        tabs: [tab],
        activeTabId: tab.id,
        projectCwd: cwd,
        projectReturnMemory: new Map(),
        projectTerminals: [],
      }),
      flush: () => {},
      skipSnapshot: () => true,
      closeToTray: () => false,
      target: new EventTarget(),
      registerClose: async () => () => {},
      registerDesktopClose: (reader) => {
        capture = reader;
        return () => {};
      },
      schedule: () => () => {},
    });
    try {
      const failure = new Error("remote denied");
      io.write.mockImplementation(async (path: string) => {
        if (path === `.voktty/sessions/${file}`) throw failure;
      });
      await expect(capture().prepare()).rejects.toBe(failure);
      expect(io.invoke).toHaveBeenCalledWith(
        "workspace_set_snapshot",
        expect.anything(),
      );
      expect(io.invoke).toHaveBeenCalledWith(
        "session_set_in_flight",
        expect.anything(),
      );
      expect(io.invoke).not.toHaveBeenCalledWith("destroy_window");
      expect(io.invoke).not.toHaveBeenCalledWith("app_exit_after_flush");
      expect(owner.capture()).not.toBeNull();
      io.write.mockResolvedValue(undefined);
      const retry = capture();
      const prepared = await retry.prepare();
      expect(prepared.isCurrent()).toBe(true);
      retry.cancel();
      expect(owner.capture()).not.toBeNull();
    } finally {
      controller.release();
      owner.retire();
    }
  },
);
