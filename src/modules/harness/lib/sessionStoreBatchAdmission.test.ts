import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/modules/harness/lib/session";

const native = vi.hoisted(() => ({ invoke: vi.fn(), remoteWrite: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock(
  "@/modules/connections/model/remoteProjects",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/modules/connections/model/remoteProjects")
    >()),
    remoteProjectForPath: () => ({
      environmentId: "batch",
      cwd: "/srv/project",
    }),
  }),
);
vi.mock("@/modules/harness/lib/remoteSessionIo", () => ({
  remoteStoreIoFor: () => ({
    key: "batch",
    environmentId: "batch",
    io: {
      read: async () => null,
      write: native.remoteWrite,
    },
  }),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function session(title: string): Session {
  return {
    id: "local",
    cwd: "/work/project",
    harness: "cursor",
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
    title,
    blocks: [{ id: "user", role: "user", text: "hello" }],
    busy: false,
  };
}

async function loadStore() {
  vi.resetModules();
  native.remoteWrite.mockResolvedValue(undefined);
  native.invoke.mockImplementation((command: string, args) => {
    if (command === "session_upsert_batch") return Promise.resolve([]);
    if (command === "session_upsert") {
      return Promise.resolve({ ...args.session, createdAt: 1, updatedAt: 1 });
    }
    return Promise.resolve();
  });
  return import("@/modules/harness/lib/sessionStore");
}

afterEach(() => {
  native.invoke.mockReset();
  native.remoteWrite.mockReset();
});

describe("batch persistence admission", () => {
  it("keeps an urgent save after an earlier batch on the same session", async () => {
    const store = await loadStore();
    const batch = store.upsertSessions([session("old")]);
    const urgent = store.upsertSession(session("new"));
    await Promise.all([batch, urgent]);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert_batch",
      "session_upsert",
    ]);
    expect(native.invoke.mock.calls[1]?.[1].session.title).toBe("new");
  });

  it("keeps archive after the admitted snapshot", async () => {
    const store = await loadStore();
    const batch = store.upsertSessions([session("old")]);
    const archive = store.setSessionArchived("local", true);
    await Promise.all([batch, archive]);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert_batch",
      "session_set_archived",
    ]);
  });

  it("does not recreate a session after a later deletion", async () => {
    const store = await loadStore();
    const batch = store.upsertSessions([session("old")]);
    const deletion = store.deleteSession("local");
    await Promise.all([batch, deletion]);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert_batch",
      "session_delete",
    ]);
  });

  it("admits local writes while a remote member of the same batch is pending", async () => {
    const store = await loadStore();
    const gate = deferred();
    native.remoteWrite.mockReturnValue(gate.promise);
    const remote = {
      ...session("remote"),
      id: "remote",
      cwd: "remote://batch/srv/project",
    };
    const batch = store.upsertSessions([remote, session("old")]);
    const urgent = store.upsertSession(session("new"));
    try {
      await vi.waitFor(() => expect(native.remoteWrite).toHaveBeenCalled());
      await urgent;
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        "session_upsert_batch",
        "session_upsert",
      ]);
    } finally {
      gate.resolve();
      await batch;
    }
  });

  it("retains the batch receipt until remote settlement after a local failure", async () => {
    const store = await loadStore();
    const gate = deferred();
    const failure = new Error("local save failed");
    native.remoteWrite.mockReturnValue(gate.promise);
    native.invoke.mockRejectedValue(failure);
    const settled = vi.fn();
    const batch = store
      .upsertSessions([
        session("old"),
        {
          ...session("remote"),
          id: "remote",
          cwd: "remote://batch/srv/project",
        },
      ])
      .then(settled, (error: unknown) => {
        settled(error);
      });
    try {
      await vi.waitFor(() =>
        expect(native.invoke).toHaveBeenCalledWith("session_upsert_batch", {
          sessions: [expect.objectContaining({ id: "local" })],
        }),
      );
      expect(settled).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await batch;
    }
    expect(settled).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("keeps a pending local batch visible to a flush captured during remote I/O", async () => {
    const store = await loadStore();
    const local = deferred();
    const remote = deferred();
    native.remoteWrite.mockReturnValue(remote.promise);
    native.invoke.mockReturnValue(local.promise.then(() => []));
    const batch = store.upsertSessions([
      session("old"),
      { ...session("remote"), id: "remote", cwd: "remote://batch/srv/project" },
    ]);
    const drained = vi.fn();
    const flush = store.flushSessionWrites().then(drained);
    try {
      remote.resolve();
      await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
      expect(drained).not.toHaveBeenCalled();
    } finally {
      local.resolve();
      remote.resolve();
      await Promise.all([batch, flush]);
    }
    expect(drained).toHaveBeenCalledOnce();
  });

  it("keeps a remote-only batch off the local IPC surface", async () => {
    const store = await loadStore();
    const summaries = await store.upsertSessions([
      { ...session("remote"), id: "remote", cwd: "remote://batch/srv/project" },
    ]);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(summaries.map((summary) => summary.id)).toEqual(["remote"]);
  });
});
