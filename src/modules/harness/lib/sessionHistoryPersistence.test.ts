import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import { clearSessionCache } from "@/modules/harness/lib/sessionStore";
import {
  renameHistorySession,
  pinHistorySession,
  unarchiveHistorySession,
} from "@/modules/harness/lib/sessionHistoryPersistence";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing history fixture");
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
  const session = {
    ...newSession("cursor", "/work/project"),
    blocks: [{ id: "user", role: "user" as const, text: "hello" }],
  };
  const updateOpen = vi.fn();
  const onPersisted = vi.fn();
  const commit = vi.fn();
  const base = { permit, sessionId: session.id };
  const rename = {
    ...base,
    displayTitle: " New title ",
    open: session,
    updateOpen,
    onPersisted,
  };
  const pin = { ...base, pinned: true, open: session, commit };
  const unarchive = { ...base, commit };
  const invoke = async (command: string, args: { session?: unknown }) => {
    if (command === "session_get")
      return { ...session, createdAt: 1, updatedAt: 1 };
    if (command === "session_upsert")
      return { ...(args.session as object), createdAt: 1, updatedAt: 1 };
  };
  native.invoke.mockImplementation(invoke);
  return {
    owner,
    permit,
    session,
    rename,
    pin,
    unarchive,
    updateOpen,
    onPersisted,
    commit,
    invoke,
    seal: () => required(required(closer.capture()).seal()),
  };
}

beforeEach(() => {
  clearSessionCache();
  native.invoke.mockReset();
});

describe("history action persistence authority", () => {
  it.each(["retire", "cancel"] as const)(
    "does not rename after %s while reading history",
    async (outcome) => {
      const f = fixture();
      const read = deferred();
      native.invoke.mockImplementation(async (command: string, args) => {
        if (command === "session_get") await read.promise;
        return f.invoke(command, args);
      });
      const writing = renameHistorySession({ ...f.rename, open: undefined });
      if (outcome === "retire") f.owner.retire();
      else f.seal().cancel();
      read.resolve();
      expect(await writing).toBe(false);
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        "session_get",
      ]);
      expect(f.onPersisted).not.toHaveBeenCalled();
      expect(f.updateOpen).not.toHaveBeenCalled();
    },
  );

  it("keeps open rename immediate and records only the saved snapshot", async () => {
    const f = fixture();
    const writing = renameHistorySession(f.rename);
    expect(f.updateOpen).toHaveBeenCalledOnce();
    expect(f.updateOpen.mock.calls[0][0].title).toBe("cursor · New title");
    expect(await writing).toBe(true);
    expect(f.onPersisted).toHaveBeenCalledOnce();
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert",
    ]);
  });

  it("does not write if updating the open title seals the action", async () => {
    const f = fixture();
    f.updateOpen.mockImplementation(() => {
      f.seal();
    });
    expect(await renameHistorySession(f.rename)).toBe(false);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(f.onPersisted).not.toHaveBeenCalled();
  });

  it("does not mark a failed rename save as persisted", async () => {
    const f = fixture();
    native.invoke.mockRejectedValue(new Error("save failed"));
    await renameHistorySession(f.rename);
    expect(f.updateOpen).toHaveBeenCalledOnce();
    expect(f.onPersisted).not.toHaveBeenCalled();
  });

  it("does not issue a pin flag after sealing during its prerequisite save", async () => {
    const f = fixture();
    const save = deferred();
    native.invoke.mockImplementation(async (command: string, args) => {
      await save.promise;
      return f.invoke(command, args);
    });
    const writing = pinHistorySession(f.pin);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    const final = f.seal();
    try {
      expect(final.pending).not.toBeNull();
    } finally {
      save.resolve();
    }
    expect(await writing).toBe(false);
    await final.pending;
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert",
    ]);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it.each(["rename", "pin", "unarchive"] as const)(
    "drains an admitted %s without stale publication",
    async (action) => {
      const f = fixture();
      const gate = deferred();
      native.invoke.mockImplementation(async (command: string, args) => {
        await gate.promise;
        return f.invoke(command, args);
      });
      const writing =
        action === "rename"
          ? renameHistorySession(f.rename)
          : action === "pin"
            ? pinHistorySession({ ...f.pin, open: undefined })
            : unarchiveHistorySession(f.unarchive);
      await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
      const final = f.seal();
      try {
        expect(final.pending).not.toBeNull();
      } finally {
        gate.resolve();
      }
      expect(await writing).toBe(false);
      await final.pending;
      expect(f.onPersisted).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it.each(["rename", "pin", "unarchive"] as const)(
    "denies %s without writes after retirement",
    async (action) => {
      const f = fixture();
      f.owner.retire();
      const result =
        action === "rename"
          ? await renameHistorySession(f.rename)
          : action === "pin"
            ? await pinHistorySession(f.pin)
            : await unarchiveHistorySession(f.unarchive);
      expect(result).toBe(false);
      expect(native.invoke).not.toHaveBeenCalled();
      expect(f.updateOpen).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it.each(["rename", "pin", "unarchive"] as const)(
    "denies %s at capacity without reporting view success",
    async (action) => {
      const f = fixture();
      const gate = deferred();
      const pending = Array.from({ length: 256 }, () =>
        f.permit.run(() => gate.promise),
      );
      try {
        const result =
          action === "rename"
            ? await renameHistorySession(f.rename)
            : action === "pin"
              ? await pinHistorySession(f.pin)
              : await unarchiveHistorySession(f.unarchive);
        expect(result).toBe(false);
        expect(native.invoke).not.toHaveBeenCalled();
        expect(f.updateOpen).not.toHaveBeenCalled();
        expect(f.commit).not.toHaveBeenCalled();
      } finally {
        gate.resolve();
        await Promise.all(pending);
      }
    },
  );

  it("preserves unarchive failure identity and skips its view update", async () => {
    const f = fixture();
    const failure = new Error("flag failed");
    native.invoke.mockRejectedValue(failure);
    await expect(unarchiveHistorySession(f.unarchive)).rejects.toBe(failure);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it("saves before pinning and preserves the existing pin catch policy", async () => {
    const f = fixture();
    native.invoke.mockImplementation(async (command: string, args) => {
      if (command === "session_set_pinned") throw new Error("flag failed");
      return f.invoke(command, args);
    });
    expect(await pinHistorySession(f.pin)).toBe(true);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert",
      "session_set_pinned",
    ]);
    expect(f.commit).toHaveBeenCalledOnce();
  });

  it("unarchives once under current authority", async () => {
    const f = fixture();
    expect(await unarchiveHistorySession(f.unarchive)).toBe(true);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith(
      "session_set_archived",
      { sessionId: f.session.id, archived: false },
    );
    expect(f.commit).toHaveBeenCalledOnce();
  });
});
