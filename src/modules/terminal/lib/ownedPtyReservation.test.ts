import { expect, it, vi } from "vitest";
import {
  createOwnedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const native = () => ({
  id: 91,
  close: vi.fn().mockResolvedValue(undefined),
  write: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn().mockResolvedValue(undefined),
});

it("reserves before acquisition without a workspace or native session descriptor", async () => {
  const registry = createOwnedPtyTargets(1);
  const destination = target();
  const acquire = vi.fn().mockImplementation(async () => {
    expect(registry.get(1)).toBe(receipt);
    expect(() => registry.reserve(2, acquire)).toThrow("limit");
    return destination;
  });
  const receipt = registry.reserve(1, acquire);
  expect(acquire).not.toHaveBeenCalled();
  const start = vi.fn().mockResolvedValue(native());
  const session = await receipt.open(start, { onData: vi.fn() });
  expect(session.workspace).toEqual(destination.workspace);
  expect(start).toHaveBeenCalledWith(
    { cwd: destination.cwd, workspace: destination.workspace },
    expect.anything(),
  );
  await registry.close(1);
  expect(destination.release).toHaveBeenCalledOnce();
});

it("does not acquire when an unopened reservation is disposed", async () => {
  const registry = createOwnedPtyTargets();
  const acquire = vi.fn();
  registry.reserve(1, acquire);
  await registry.close(1);
  expect(acquire).not.toHaveBeenCalled();
  expect(registry.size()).toBe(0);
});

it("rejects malformed reconnect folders before retiring the reservation", async () => {
  const registry = createOwnedPtyTargets();
  const acquire = vi.fn();
  const receipt = registry.reserve(1, acquire);
  await expect(
    registry.prepareReconnect(1, "/bad\0folder", () => true),
  ).rejects.toThrow("resolved folder");
  expect(receipt.isCurrent()).toBe(true);
  expect(acquire).not.toHaveBeenCalled();
  await registry.close(1);
});

it("retains a cancelled acquisition and failed late cleanup against capacity", async () => {
  const registry = createOwnedPtyTargets(1);
  const pending = deferred<OwnedPtyTarget>();
  const receipt = registry.reserve(1, () => pending.promise);
  const start = vi.fn().mockResolvedValue(native());
  const opening = receipt.open(start, { onData: vi.fn() });
  const rejected = expect(opening).rejects.toThrow("retired");
  await Promise.resolve();
  const closing = registry.close(1);
  const failed = expect(closing).rejects.toThrow("release failed");
  expect(() => registry.reserve(2, vi.fn())).toThrow("limit");
  const late = target();
  vi.mocked(late.release).mockRejectedValueOnce(new Error("release failed"));
  pending.resolve(late);
  await rejected;
  await failed;
  expect(start).not.toHaveBeenCalled();
  expect(registry.size()).toBe(1);
  await registry.close(1);
  expect(late.release).toHaveBeenCalledTimes(2);
  expect(registry.size()).toBe(0);
});

it("reconnects a failed reservation and uses its original resolver after cancellation", async () => {
  const registry = createOwnedPtyTargets();
  const destination = target(8);
  const acquire = vi
    .fn()
    .mockRejectedValueOnce(new Error("missing profile"))
    .mockResolvedValueOnce(destination);
  const receipt = registry.reserve(1, acquire);
  const start = vi.fn().mockResolvedValue(native());
  await expect(receipt.open(start, { onData: vi.fn() })).rejects.toThrow(
    "missing profile",
  );
  expect(start).not.toHaveBeenCalled();
  await receipt.close();
  await registry.prepareReconnect(1, undefined, () => true);
  const next = registry.get(1);
  if (!next) throw new Error("Missing current reservation.");
  await next.open(start, { onData: vi.fn() });
  expect(acquire).toHaveBeenCalledTimes(2);
  await registry.close(1);
  expect(destination.release).toHaveBeenCalledOnce();
});
