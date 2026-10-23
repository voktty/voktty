import { expect, it, vi } from "vitest";
import {
  createOwnedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";
import type { PtySession } from "@/modules/terminal/lib/pty-bridge";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function target(id = 7): OwnedPtyTarget {
  return {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: id,
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
const sink = () => ({ onData: vi.fn() });

it("holds the exact slot through native close and helper release before installing a fresh receipt", async () => {
  const registry = createOwnedPtyTargets(1);
  const source = target();
  const sibling = target(8);
  source.acquireSibling = vi.fn().mockResolvedValue(sibling);
  const original = registry.register(1, source);
  const pty = native();
  const close = deferred<void>();
  const release = deferred<void>();
  vi.mocked(pty.close).mockReturnValueOnce(close.promise);
  vi.mocked(source.release).mockReturnValueOnce(release.promise);
  const oldSession = await original.open(async () => pty, sink());
  const renewal = registry.prepareReconnect(1, "/srv/app/src", () => true);
  expect(original.isCurrent()).toBe(false);
  await vi.waitFor(() => expect(pty.close).toHaveBeenCalledOnce());
  expect(registry.get(1)).toBe(original);
  expect(() => registry.register(2, target())).toThrow("limit");
  expect(source.acquireSibling).not.toHaveBeenCalled();
  close.resolve();
  await vi.waitFor(() => expect(source.release).toHaveBeenCalledOnce());
  expect(registry.get(1)).toBe(original);
  release.resolve();
  await renewal;
  const next = registry.get(1);
  if (!next) throw new Error("Expected a successor receipt");
  expect(next).not.toBe(original);
  expect(source.acquireSibling).not.toHaveBeenCalled();
  const currentNative = native();
  const current = await next.open(async () => currentNative, sink());
  expect(source.acquireSibling).toHaveBeenCalledExactlyOnceWith("/srv/app/src");
  expect(current.workspace).toMatchObject({ sessionId: 8 });
  await oldSession.close();
  await original.dispose();
  expect(registry.get(1)).toBe(next);
  expect(next.isCurrent()).toBe(true);
  expect(currentNative.close).not.toHaveBeenCalled();
  await registry.close(1);
  expect(sibling.release).toHaveBeenCalledOnce();
});

it.each(["native", "helper"])(
  "retains failed %s cleanup for retry before reacquisition",
  async (phase) => {
    const registry = createOwnedPtyTargets();
    const source = target();
    source.acquireSibling = vi.fn().mockResolvedValue(target(8));
    const original = registry.register(1, source);
    const pty = native();
    vi.mocked(
      phase === "native" ? pty.close : source.release,
    ).mockRejectedValueOnce(new Error("cleanup failed"));
    await original.open(async () => pty, sink());
    await expect(
      registry.prepareReconnect(1, undefined, () => true),
    ).rejects.toThrow("cleanup failed");
    expect(registry.get(1)).toBe(original);
    expect(source.acquireSibling).not.toHaveBeenCalled();
    await registry.prepareReconnect(1, undefined, () => true);
    expect(registry.get(1)).not.toBe(original);
    expect(pty.close).toHaveBeenCalledTimes(phase === "native" ? 2 : 1);
    expect(source.release).toHaveBeenCalledTimes(phase === "helper" ? 2 : 1);
    await registry.close(1);
  },
);

it.each(["cancel", "dispose"])(
  "does not install a replacement after %s during cleanup",
  async (action) => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const release = deferred<void>();
    source.acquireSibling = vi.fn();
    vi.mocked(source.release).mockReturnValue(release.promise);
    const original = registry.register(1, source);
    let current = true;
    const renewal = registry.prepareReconnect(1, undefined, () => current);
    const retired = expect(renewal).rejects.toThrow("retired");
    await vi.waitFor(() => expect(source.release).toHaveBeenCalledOnce());
    current = false;
    const closing =
      action === "dispose" ? registry.close(1) : Promise.resolve();
    release.resolve();
    await retired;
    await closing;
    expect(source.acquireSibling).not.toHaveBeenCalled();
    expect(registry.get(1)).toBe(action === "dispose" ? undefined : original);
    await registry.close(1);
  },
);

it("only the latest current caller can replace a captured predecessor", async () => {
  const registry = createOwnedPtyTargets();
  const source = target();
  const release = deferred<void>();
  vi.mocked(source.release).mockReturnValue(release.promise);
  source.acquireSibling = vi.fn().mockResolvedValue(target(8));
  registry.register(1, source);
  let attempt = 1;
  const first = registry.prepareReconnect(
    1,
    "/srv/app/old",
    () => attempt === 1,
  );
  const retired = expect(first).rejects.toThrow("retired");
  attempt = 2;
  const second = registry.prepareReconnect(
    1,
    "/srv/app/current",
    () => attempt === 2,
  );
  release.resolve();
  await retired;
  await second;
  const receipt = registry.get(1);
  if (!receipt) throw new Error("Expected the current receipt");
  await receipt.open(async () => native(), sink());
  expect(source.acquireSibling).toHaveBeenCalledExactlyOnceWith(
    "/srv/app/current",
  );
  await registry.close(1);
});

it("bounds unsettled reconnect callers while preserving the original resource slot", async () => {
  const registry = createOwnedPtyTargets(2);
  const source = target();
  const release = deferred<void>();
  vi.mocked(source.release).mockReturnValue(release.promise);
  source.acquireSibling = vi.fn();
  registry.register(1, source);
  let current = true;
  const first = registry.prepareReconnect(1, undefined, () => current);
  const firstRetired = expect(first).rejects.toThrow("retired");
  const second = registry.prepareReconnect(1, undefined, () => current);
  const secondRetired = expect(second).rejects.toThrow("retired");
  await expect(
    registry.prepareReconnect(1, undefined, () => true),
  ).rejects.toThrow("reconnect limit");
  expect(registry.size()).toBe(1);
  current = false;
  release.resolve();
  await firstRetired;
  await secondRetired;
  await registry.prepareReconnect(1, undefined, () => true);
  expect(registry.size()).toBe(1);
  await registry.close(1);
});

it("rejects an unresolved folder before retiring the current native session", async () => {
  const registry = createOwnedPtyTargets();
  const source = target();
  source.acquireSibling = vi.fn();
  const receipt = registry.register(1, source);
  await expect(
    registry.prepareReconnect(1, "remote://unresolved/root", () => true),
  ).rejects.toThrow("resolved folder");
  expect(receipt.isCurrent()).toBe(true);
  expect(source.release).not.toHaveBeenCalled();
  await registry.close(1);
});
