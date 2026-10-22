import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import { moveSessionWorktree } from "@/modules/harness/lib/sessionWorktreePersistence";
import type { Worktree } from "@/modules/harness/lib/worktrees";

const native = vi.hoisted(() => ({ invoke: vi.fn(), list: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/modules/harness/lib/worktrees", () => ({
  listWorktrees: native.list,
}));

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing worktree fixture");
  return value;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tree: Worktree = {
  path: "/work/target",
  branch: "target",
  head: "",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
};
const listed = { worktrees: [tree], defaultRoot: "/work/project" };
function fixture() {
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const closer = authority.createOwner();
  const permit = required(owner.capture());
  const session = {
    ...newSession("cursor", "/work/project"),
    worktreeRemoved: true,
    blocks: [{ id: "user", role: "user" as const, text: "hello" }],
  };
  const commit = vi.fn();
  const isCurrent = vi.fn(() => true);
  const options = { session, targetPath: tree.path, permit, isCurrent, commit };
  return {
    options,
    commit,
    isCurrent,
    permit,
    seal: () => required(required(closer.capture()).seal()),
  };
}
beforeEach(() => {
  native.list.mockReset().mockResolvedValue(listed);
  native.invoke
    .mockReset()
    .mockImplementation(async (_command: string, args) => ({
      ...args.session,
      createdAt: 1,
      updatedAt: 1,
    }));
});

describe("worktree persistence admission", () => {
  it.each(["close", "navigation"] as const)(
    "does not save or commit after %s during listing",
    async (kind) => {
      const f = fixture();
      const gate = deferred();
      native.list.mockImplementation(async () => {
        await gate.promise;
        return listed;
      });
      const pending = moveSessionWorktree(f.options);
      if (kind === "close") f.seal().cancel();
      else f.isCurrent.mockReturnValue(false);
      gate.resolve();
      expect(await pending).toBe(false);
      expect(native.invoke).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it("retains the admitted save until settlement without publishing after seal", async () => {
    const f = fixture();
    const gate = deferred();
    native.invoke.mockImplementation(async (_command: string, args) => {
      await gate.promise;
      return { ...args.session, createdAt: 1, updatedAt: 1 };
    });
    const pending = moveSessionWorktree(f.options);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    const final = f.seal();
    try {
      expect(final.pending).not.toBeNull();
    } finally {
      gate.resolve();
    }
    expect(await pending).toBe(false);
    await final.pending;
    expect(f.commit).not.toHaveBeenCalled();
  });

  it("denies a save at capacity without committing pins or sessions", async () => {
    const f = fixture();
    const gate = deferred();
    const pending = Array.from({ length: 256 }, () =>
      f.permit.run(() => gate.promise),
    );
    try {
      expect(await moveSessionWorktree(f.options)).toBe(false);
      expect(native.invoke).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await Promise.all(pending);
    }
  });

  it("copies source scalar settings and the transcript array before listing", async () => {
    const f = fixture();
    const gate = deferred();
    native.list.mockImplementation(async () => {
      await gate.promise;
      return listed;
    });
    const pending = moveSessionWorktree(f.options);
    f.options.session.cwd = "/work/changed";
    f.options.session.modelSettings.extra = "changed";
    f.options.session.blocks.push({ id: "extra", role: "user", text: "later" });
    gate.resolve();
    expect(await pending).toBe(true);
    const payload = native.invoke.mock.calls[0][1].session;
    expect(payload.cwd).toBe("/work/project");
    expect(payload.modelSettings.extra).toBeUndefined();
    expect(
      payload.blocks.some((block: { id: string }) => block.id === "extra"),
    ).toBe(false);
  });

  it("keeps a missing worktree error for a current action", async () => {
    const f = fixture();
    native.list.mockResolvedValue({
      worktrees: [],
      defaultRoot: "/work/project",
    });
    await expect(moveSessionWorktree(f.options)).rejects.toThrow(
      "This worktree is no longer available.",
    );
    expect(f.commit).not.toHaveBeenCalled();
  });

  it.each(["current", "retired"] as const)(
    "preserves only a %s storage error",
    async (kind) => {
      const f = fixture();
      const gate = deferred();
      const failure = new Error("save failed");
      native.invoke.mockReturnValue(gate.promise);
      const pending = moveSessionWorktree(f.options).catch(
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
      if (kind === "retired") f.seal();
      gate.reject(failure);
      expect(await pending).toBe(kind === "current" ? failure : false);
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it("publishes an admitted draft move without a transcript write", async () => {
    const f = fixture();
    expect(
      await moveSessionWorktree({
        ...f.options,
        session: newSession("cursor", "/work/project"),
      }),
    ).toBe(true);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.commit.mock.calls[0][0].worktreeCwd).toBe(tree.path);
  });
});
