import { expect, it, vi } from "vitest";
import {
  createOwnedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";
import type { PtySession } from "@/modules/terminal/lib/pty-bridge";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function target(sessionId = 7): OwnedPtyTarget {
  return {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    release: vi.fn().mockResolvedValue(undefined),
  };
}
function native(): PtySession {
  return {
    id: 91,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}
const handlers = () => ({ onData: vi.fn() });

it("acquires an independent sibling after the source lease was released", async () => {
  const registry = createOwnedPtyTargets();
  const sibling = target(8);
  const source = target();
  source.acquireSibling = vi.fn().mockResolvedValue(sibling);
  const original = registry.register(1, source);
  await registry.close(1);
  expect(original.isCurrent()).toBe(false);
  const receipt = registry.claimSibling(2, source.workspace, "/srv/app/src");
  expect(receipt).toBeDefined();
  if (!receipt) throw new Error("Expected a sibling receipt");
  expect(source.acquireSibling).not.toHaveBeenCalled();
  const start = vi.fn().mockResolvedValue(native());
  const session = await receipt.open(start, handlers());
  expect(source.acquireSibling).toHaveBeenCalledExactlyOnceWith("/srv/app/src");
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      workspace: expect.objectContaining({ sessionId: 8 }),
    }),
    expect.anything(),
  );
  expect(session.workspace).toEqual(sibling.workspace);
  expect(source.release).toHaveBeenCalledOnce();
  expect(sibling.release).not.toHaveBeenCalled();
  await registry.close(2);
  expect(sibling.release).toHaveBeenCalledOnce();
});

it("reserves before a reentrant acquisition and releases a late lease without opening native", async () => {
  const registry = createOwnedPtyTargets();
  const pending = deferred<OwnedPtyTarget>();
  const source = target();
  source.acquireSibling = vi.fn().mockImplementation(() => {
    expect(registry.get(2)).toBeDefined();
    void registry.close(2);
    return pending.promise;
  });
  registry.register(1, source);
  const receipt = registry.claimSibling(2, source.workspace);
  if (!receipt) throw new Error("Expected a sibling receipt");
  const start = vi.fn();
  const opening = receipt.open(start, handlers());
  const failed = expect(opening).rejects.toThrow("retired");
  await vi.waitFor(() => expect(source.acquireSibling).toHaveBeenCalledOnce());
  const late = target(9);
  pending.resolve(late);
  await failed;
  await registry.close(2);
  expect(late.release).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  expect(source.release).not.toHaveBeenCalled();
  await registry.close(1);
});

it("counts pending acquisitions and failed cleanup against the same leaf budget", async () => {
  const registry = createOwnedPtyTargets(2);
  const pending = deferred<OwnedPtyTarget>();
  const source = target();
  source.acquireSibling = vi.fn().mockReturnValue(pending.promise);
  registry.register(1, source);
  const receipt = registry.claimSibling(2, source.workspace);
  if (!receipt) throw new Error("Expected a sibling receipt");
  const opening = receipt.open(async () => native(), handlers());
  const failed = expect(opening).rejects.toThrow("retired");
  await Promise.resolve();
  expect(() => registry.claimSibling(3, source.workspace)).toThrow("limit");
  const closing = registry.close(2);
  const cleanupFailed = expect(closing).rejects.toThrow("cleanup failed");
  const late = target(9);
  vi.mocked(late.release).mockRejectedValueOnce(new Error("cleanup failed"));
  pending.resolve(late);
  await failed;
  await cleanupFailed;
  expect(() => registry.claimSibling(3, source.workspace)).toThrow("limit");
  expect(source.acquireSibling).toHaveBeenCalledOnce();
  await registry.close(2);
  expect(late.release).toHaveBeenCalledTimes(2);
  expect(registry.claimSibling(3, source.workspace)).toBeDefined();
  await registry.close(3);
  await registry.close(1);
});

it("retries acquisition failure without falling back to the source native session", async () => {
  const registry = createOwnedPtyTargets();
  const source = target();
  const sibling = target(10);
  source.acquireSibling = vi
    .fn()
    .mockRejectedValueOnce(new Error("connection failed"))
    .mockResolvedValueOnce(sibling);
  registry.register(1, source);
  const receipt = registry.claimSibling(2, source.workspace);
  if (!receipt) throw new Error("Expected a sibling receipt");
  const start = vi.fn().mockResolvedValue(native());
  await expect(receipt.open(start, handlers())).rejects.toThrow(
    "connection failed",
  );
  expect(start).not.toHaveBeenCalled();
  await receipt.open(start, handlers());
  expect(source.acquireSibling).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      workspace: expect.objectContaining({ sessionId: 10 }),
    }),
    expect.anything(),
  );
  await registry.close(2);
  await registry.close(1);
});

it("retains the acquired sibling lease through native open retry and exact close settlement", async () => {
  const registry = createOwnedPtyTargets();
  const source = target();
  const sibling = target(11);
  source.acquireSibling = vi.fn().mockResolvedValue(sibling);
  registry.register(1, source);
  const receipt = registry.claimSibling(2, source.workspace);
  if (!receipt) throw new Error("Expected a sibling receipt");
  const pty = native();
  const close = deferred<void>();
  vi.mocked(pty.close).mockReturnValueOnce(close.promise);
  const start = vi
    .fn()
    .mockRejectedValueOnce(new Error("native failed"))
    .mockResolvedValueOnce(pty);
  await expect(receipt.open(start, handlers())).rejects.toThrow(
    "native failed",
  );
  const session = await receipt.open(start, handlers());
  expect(source.acquireSibling).toHaveBeenCalledOnce();
  const closing = session.close();
  await vi.waitFor(() => expect(pty.close).toHaveBeenCalledOnce());
  expect(sibling.release).not.toHaveBeenCalled();
  close.resolve();
  await closing;
  expect(sibling.release).toHaveBeenCalledOnce();
  expect(source.release).not.toHaveBeenCalled();
  await registry.close(2);
  await registry.close(1);
});

it("never acquires for a disposed unopened sibling or an invalid remote URI", async () => {
  const registry = createOwnedPtyTargets();
  const source = target();
  source.acquireSibling = vi.fn();
  registry.register(1, source);
  registry.claimSibling(2, source.workspace);
  await registry.close(2);
  expect(() =>
    registry.claimSibling(3, source.workspace, "remote://unresolved/root"),
  ).toThrow("resolved folder");
  expect(source.acquireSibling).not.toHaveBeenCalled();
  await registry.close(1);
});
