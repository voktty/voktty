import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import { persistSessionRemoval } from "@/modules/harness/lib/sessionRemovalPersistence";

const native = vi.hoisted(() => ({ invoke: vi.fn(), checkpoint: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/modules/harness/lib/checkpoint", () => ({
  flushSessionCheckpoint: native.checkpoint,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture(mode: "archive" | "delete" = "archive") {
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const closer = authority.createOwner();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing removal permit");
  const session = {
    ...newSession("cursor", "/work/project"),
    blocks: [{ id: "user", role: "user" as const, text: "hello" }],
  };
  const options = {
    sessionId: session.id,
    mode,
    session,
    isCurrent: permit.isCurrent,
  };
  return {
    options,
    run: () => persistSessionRemoval(options),
    seal: () => {
      const final = closer.capture()?.seal();
      if (!final) throw new Error("Missing final removal permit");
      return final;
    },
  };
}

beforeEach(() => {
  native.checkpoint.mockReset().mockResolvedValue(undefined);
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string, args) =>
      command === "session_upsert"
        ? { ...args.session, createdAt: 1, updatedAt: 1 }
        : undefined,
    );
});

describe("removal persistence phases", () => {
  it.each(["archive", "delete"] as const)(
    "does not start %s writes when the checkpoint completes after sealing",
    async (mode) => {
      const f = fixture(mode);
      const checkpoint = deferred();
      native.checkpoint.mockReturnValue(checkpoint.promise);
      const writing = f.run();
      expect(native.checkpoint).toHaveBeenCalledOnce();
      f.seal();
      checkpoint.resolve();
      expect(await writing).toBeNull();
      expect(native.invoke).not.toHaveBeenCalled();
    },
  );

  it("does not start an archive flag after a sealed transcript write", async () => {
    const f = fixture();
    const save = deferred();
    native.invoke.mockImplementation(async (_command: string, args) => {
      await save.promise;
      return { ...args.session, createdAt: 1, updatedAt: 1 };
    });
    const writing = f.run();
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    f.seal();
    save.resolve();
    expect(await writing).toBeNull();
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert",
    ]);
  });

  it("returns no success to an old action after close cancellation", async () => {
    const f = fixture();
    const save = deferred();
    native.invoke.mockImplementation(async (_command: string, args) => {
      await save.promise;
      return { ...args.session, createdAt: 1, updatedAt: 1 };
    });
    const writing = f.run();
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    f.seal().cancel();
    save.resolve();
    expect(await writing).toBeNull();
    expect(native.invoke).toHaveBeenCalledOnce();
  });

  it("preserves the exact storage failure without issuing the archive flag", async () => {
    const f = fixture();
    const failure = new Error("storage unavailable");
    native.invoke.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert",
    ]);
  });

  it("archives only after the transcript save succeeds", async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({
      summary: { id: f.options.sessionId },
    });
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert",
      "session_set_archived",
    ]);
  });

  it("deletes after the checkpoint without saving or archiving", async () => {
    const f = fixture("delete");
    expect(await f.run()).toEqual({});
    expect(native.checkpoint).toHaveBeenCalledWith(f.options.sessionId);
    expect(native.invoke.mock.calls).toEqual([
      ["session_delete", { sessionId: f.options.sessionId }],
    ]);
  });

  it("does not touch any phase with an invalid original permit", async () => {
    const f = fixture();
    f.seal();
    expect(await f.run()).toBeNull();
    expect(native.checkpoint).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("does not checkpoint a history-only deletion", async () => {
    const f = fixture("delete");
    expect(
      await persistSessionRemoval({ ...f.options, session: undefined }),
    ).toEqual({});
    expect(native.checkpoint).not.toHaveBeenCalled();
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("session_delete", {
      sessionId: f.options.sessionId,
    });
  });
});
