import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import {
  clearSessionCache,
  getSession,
  type SessionRecord,
} from "@/modules/harness/lib/sessionStore";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing repair fixture");
  return value;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture() {
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const closer = authority.createOwner();
  const permit = required(owner.capture());
  const record: SessionRecord = {
    ...newSession("codex", "/work/project"),
    createdAt: 1,
    updatedAt: 1,
    blocks: [
      { id: "user", role: "user", text: "hello" },
      {
        id: "shell",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec",
          kind: "execute",
          title: "Shell",
          preview: { kind: "shell", title: "echo hello" },
        },
      },
    ],
  };
  native.invoke.mockImplementation(async (command: string, args) =>
    command === "session_get"
      ? record
      : { ...args.session, createdAt: 1, updatedAt: 1 },
  );
  return {
    owner,
    permit,
    record,
    seal: () => required(required(closer.capture()).seal()),
  };
}

beforeEach(() => {
  clearSessionCache();
  native.invoke.mockReset();
});

describe("read repair persistence admission", () => {
  it.each(["retire", "cancel"] as const)(
    "does not repair after %s during a read",
    async (outcome) => {
      const f = fixture();
      const read = deferred();
      native.invoke.mockImplementation(async (command: string, args) => {
        if (command === "session_get") {
          await read.promise;
          return f.record;
        }
        return { ...args.session, createdAt: 1, updatedAt: 1 };
      });
      const loading = getSession(f.record.id, f.permit);
      if (outcome === "retire") f.owner.retire();
      else f.seal().cancel();
      read.resolve();
      const loaded = await loading;
      expect(loaded?.blocks[1].text).not.toBe("Shell");
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        "session_get",
      ]);
    },
  );

  it("counts admitted repairs in final close's pending writes", async () => {
    const f = fixture();
    const save = deferred();
    native.invoke.mockImplementation(async (command: string, args) => {
      if (command === "session_get") return f.record;
      await save.promise;
      return { ...args.session, createdAt: 1, updatedAt: 1 };
    });
    const loading = getSession(f.record.id, f.permit);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
    const final = f.seal();
    try {
      expect(final.pending).not.toBeNull();
    } finally {
      save.resolve();
      await loading;
    }
    await final.pending;
  });

  it("keeps the repaired read usable when write capacity is exhausted", async () => {
    const f = fixture();
    const gate = deferred();
    const writes = Array.from({ length: 256 }, () =>
      f.permit.run(() => gate.promise),
    );
    try {
      expect(
        (await getSession(f.record.id, f.permit))?.blocks[1].text,
      ).not.toBe("Shell");
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        "session_get",
      ]);
    } finally {
      gate.resolve();
      await Promise.all(writes);
    }
  });

  it("preserves legacy repair writes when no permit was supplied", async () => {
    const f = fixture();
    expect((await getSession(f.record.id))?.blocks[1].text).not.toBe("Shell");
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_get",
      "session_upsert",
    ]);
  });
});
