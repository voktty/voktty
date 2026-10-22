import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "@/modules/harness/lib/session";
import type { SessionRecord } from "@/modules/harness/lib/sessionStore";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@/modules/harness/lib/windowTransferBootstrap", () => ({
  loadWindowTransfer: vi.fn(async () => null),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing bootstrap fixture");
  return value;
}

beforeEach(() => {
  vi.resetModules();
  native.invoke.mockReset();
});

async function fixture(repair = false) {
  const lifecycle = await import("@/modules/harness/lib/appLifecycle");
  const { windowPersistenceAdmission: authority } = await import(
    "@/modules/harness/lib/persistenceAdmission"
  );
  const store = await import("@/modules/harness/lib/sessionStore");
  const record: SessionRecord = {
    ...newSession(repair ? "codex" : "cursor", "/work/project"),
    createdAt: 1,
    updatedAt: 1,
    blocks: [
      { id: "user", role: "user", text: "continue" },
      ...(repair
        ? [
            {
              id: "shell",
              role: "tool" as const,
              text: "Shell",
              tool: {
                callId: "exec",
                kind: "execute" as const,
                title: "Shell",
                preview: { kind: "shell" as const, title: "echo hello" },
              },
            },
          ]
        : []),
    ],
  };
  native.invoke.mockImplementation(async (command: string, args) => {
    switch (command) {
      case "workspace_get_snapshot":
        return null;
      case "session_list_in_flight":
        return [{ sessionId: record.id, cwd: record.cwd }];
      case "session_get":
        return record;
      case "session_upsert":
        return { ...args.session, createdAt: 1, updatedAt: 1 };
      case "session_upsert_batch":
        return [];
      default:
        return undefined;
    }
  });
  const commands = () => native.invoke.mock.calls.map(([command]) => command);
  const writes = () =>
    commands().filter(
      (command) =>
        command === "session_upsert" || command === "session_upsert_batch",
    );
  const closer = authority.createOwner();
  return {
    lifecycle,
    authority,
    store,
    record,
    commands,
    writes,
    seal: () => required(required(closer.capture()).seal()),
    release: () => closer.retire(),
  };
}

describe("boot load persistence authority with real session storage", () => {
  it.each(["sealed", "cancelled"] as const)(
    "does not start session reads after %s metadata loading",
    async (mode) => {
      const f = await fixture();
      const gate = deferred<null>();
      native.invoke.mockImplementationOnce(() => gate.promise);
      const loading = f.lifecycle.loadResumedWorkspace();
      const final = f.seal();
      if (mode === "cancelled") final.cancel();
      gate.resolve(null);
      try {
        expect(await loading).toBeNull();
        expect(f.commands()).not.toContain("session_get");
        expect(f.writes()).toEqual([]);
      } finally {
        f.release();
      }
    },
  );

  it.each(["sealed", "cancelled", "view"] as const)(
    "does not repair or publish a session after %s during its read",
    async (mode) => {
      const f = await fixture(true);
      const gate = deferred<SessionRecord>();
      const original = required(native.invoke.getMockImplementation() ?? null);
      native.invoke.mockImplementation((command: string, args) =>
        command === "session_get" ? gate.promise : original(command, args),
      );
      const loading = f.lifecycle.loadResumedWorkspace();
      await vi.waitFor(() => expect(f.commands()).toContain("session_get"));
      if (mode === "view") {
        const release = f.lifecycle.setQuitWorkspace(
          () => [],
          () => [],
          () => "",
          () => "/work/live",
          () => [],
          () => new Map(),
          () => undefined,
        );
        release();
      } else {
        const final = f.seal();
        if (mode === "cancelled") final.cancel();
      }
      gate.resolve(f.record);
      try {
        expect(await loading).toBeNull();
        expect(f.writes()).toEqual([]);
        await f.lifecycle.reportQuitPoll(80);
        expect(native.invoke).toHaveBeenCalledWith("quit_poll_reply", {
          id: 80,
          inFlight: 0,
        });
      } finally {
        f.release();
      }
    },
  );

  it.each(["session_upsert", "session_upsert_batch"] as const)(
    "final close drains admitted %s without letting bootstrap continue",
    async (writer) => {
      const f = await fixture(writer === "session_upsert");
      const gate = deferred<unknown>();
      const original = required(native.invoke.getMockImplementation() ?? null);
      native.invoke.mockImplementation((command: string, args) =>
        command === writer ? gate.promise : original(command, args),
      );
      const loading = f.lifecycle.loadResumedWorkspace();
      await vi.waitFor(() => expect(f.writes()).toContain(writer));
      const final = f.seal();
      let drained = false;
      const draining = required(final.pending).then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      gate.resolve(
        writer === "session_upsert"
          ? { ...f.record, createdAt: 1, updatedAt: 1 }
          : [],
      );
      try {
        await draining;
        expect(drained).toBe(true);
        expect(await loading).toBeNull();
        expect(f.writes()).toEqual([writer]);
      } finally {
        f.release();
      }
    },
  );

  it("coalesces boot and preserves usable interrupted sessions", async () => {
    const f = await fixture(true);
    try {
      const first = f.lifecycle.loadResumedWorkspace();
      expect(f.lifecycle.loadResumedWorkspace()).toBe(first);
      const resumed = required(await first);
      expect(resumed.sessions[0].id).toBe(f.record.id);
      expect(resumed.sessions[0].blocks[1].text).not.toBe("Shell");
      expect(f.writes()).toEqual(["session_upsert", "session_upsert_batch"]);
      expect(
        f.commands().filter((command) => command === "session_get"),
      ).toHaveLength(1);
      expect(f.seal().pending).toBeNull();
    } finally {
      f.release();
    }
  });

  it("a retired bootstrap read cannot replace the live session cache", async () => {
    const f = await fixture();
    const gate = deferred<SessionRecord>();
    const original = required(native.invoke.getMockImplementation() ?? null);
    native.invoke.mockImplementation((command: string, args) =>
      command === "session_get" ? gate.promise : original(command, args),
    );
    const loading = f.lifecycle.loadResumedWorkspace();
    await vi.waitFor(() => expect(f.commands()).toContain("session_get"));
    const current = {
      ...newSession("cursor", f.record.cwd),
      id: f.record.id,
      title: "Live session",
      blocks: [{ id: "live-user", role: "user" as const, text: "new turn" }],
    };
    const release = f.lifecycle.setQuitWorkspace(
      () => [current],
      () => [],
      () => "",
      () => current.cwd,
      () => [],
      () => new Map(),
      () => undefined,
    );
    try {
      await f.store.upsertSession(current);
      gate.resolve(f.record);
      expect(await loading).toBeNull();
      expect(f.store.getCachedSession(current.id)).toEqual(current);
    } finally {
      gate.resolve(f.record);
      await loading;
      release();
      f.release();
    }
  });

  it("does no bootstrap IO while final persistence is sealed", async () => {
    const f = await fixture();
    f.seal();
    try {
      expect(await f.lifecycle.loadResumedWorkspace()).toBeNull();
      expect(f.commands()).toEqual([]);
    } finally {
      f.release();
    }
  });

  it("keeps boot usable when write capacity is exhausted", async () => {
    const f = await fixture(true);
    const owner = f.authority.createOwner();
    const permit = required(owner.capture());
    const gate = deferred<void>();
    const writes = Array.from({ length: 256 }, () =>
      permit.run(() => gate.promise),
    );
    try {
      const resumed = required(await f.lifecycle.loadResumedWorkspace());
      expect(resumed.sessions[0].blocks[1].text).not.toBe("Shell");
      expect(f.writes()).toEqual([]);
    } finally {
      gate.resolve();
      await Promise.all(writes);
      owner.retire();
      f.release();
    }
  });
});
