import { describe, expect, it, vi } from "vitest";
import {
  createOwnedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function target(): OwnedPtyTarget {
  return {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    release: vi.fn().mockResolvedValue(undefined),
  };
}
function pty(): PtySession {
  return {
    id: 91,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}
const handlers = () => ({
  onData: vi.fn(),
  onExit: vi.fn(),
  onResize: vi.fn(),
});

describe("owned PTY target lifetime", () => {
  it.each(["remote folder", "missing session", "invalid session"])(
    "rejects a deferred %s on every open and retains its exact cleanup",
    async (invalid) => {
      const registry = createOwnedPtyTargets(2);
      const resolved = target();
      if (invalid === "remote folder") resolved.cwd = "remote://build/srv/app";
      if (invalid === "missing session") delete resolved.workspace.sessionId;
      if (invalid === "invalid session") resolved.workspace.sessionId = -1;
      const acquire = vi.fn().mockResolvedValue(resolved);
      const source = target();
      source.acquireSibling = acquire;
      registry.register(1, source);
      const sibling = registry.claimSibling(2, source.workspace, "/srv/app");
      expect(sibling).toBeDefined();
      if (!sibling) throw new Error("Missing sibling receipt.");
      const start = vi.fn().mockResolvedValue(pty());
      await expect(sibling.open(start, handlers())).rejects.toThrow(
        "Terminal resource requires",
      );
      await expect(sibling.open(start, handlers())).rejects.toThrow(
        "Terminal resource requires",
      );
      expect(start).not.toHaveBeenCalled();
      expect(acquire).toHaveBeenCalledOnce();
      expect(resolved.release).not.toHaveBeenCalled();
      vi.mocked(resolved.release).mockRejectedValueOnce(
        new Error("release failed"),
      );
      await expect(registry.close(2)).rejects.toThrow("release failed");
      expect(registry.size()).toBe(2);
      expect(() => registry.register(3, target())).toThrow("limit");
      await registry.close(2);
      expect(resolved.release).toHaveBeenCalledTimes(2);
      expect(source.release).not.toHaveBeenCalled();
      await registry.close(1);
      expect(registry.size()).toBe(0);
    },
  );

  it("retries disposed cleanup on demand while coalescing a still-pending retry", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    const native = pty();
    const pending = deferred<void>();
    vi.mocked(native.close)
      .mockRejectedValueOnce(new Error("close failed"))
      .mockReturnValueOnce(pending.promise);
    await receipt.open(async () => native, handlers());
    await expect(registry.close(1)).rejects.toThrow("close failed");
    registry.retryCleanup();
    registry.retryCleanup();
    await vi.waitFor(() => expect(native.close).toHaveBeenCalledTimes(2));
    expect(source.release).not.toHaveBeenCalled();
    pending.resolve();
    await vi.waitFor(() => expect(registry.size()).toBe(0));
    expect(source.release).toHaveBeenCalledOnce();
  });
  it("bounds the default registry to 256 live or cleanup-pending leaves", async () => {
    const registry = createOwnedPtyTargets();
    for (let id = 0; id < 256; id++) registry.register(id, target());
    expect(() => registry.register(256, target())).toThrow("limit");
    await Promise.all(
      Array.from({ length: 256 }, (_, id) => registry.close(id)),
    );
    expect(registry.size()).toBe(0);
  });

  it("starts cleanup even when the original exit callback throws", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    let captured!: PtyHandlers;
    const native = pty();
    await receipt.open(
      async (_target, sink) => {
        captured = sink;
        return native;
      },
      {
        onData: vi.fn(),
        onExit: () => {
          throw new Error("callback failed");
        },
      },
    );
    expect(() => captured.onExit?.(0)).toThrow("callback failed");
    expect(receipt.isCurrent()).toBe(false);
    await registry.close(1);
    expect(native.close).toHaveBeenCalledOnce();
    expect(source.release).toHaveBeenCalledOnce();
  });
  it("captures the original target and leaves the lease held until native close settles", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    source.cwd = "/srv/other";
    source.workspace.connection.host = "other.example";
    const native = pty();
    const closing = deferred<void>();
    vi.mocked(native.close).mockReturnValueOnce(closing.promise);
    const start = vi.fn().mockResolvedValue(native);
    const session = await receipt.open(start, handlers());
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/srv/app",
        workspace: expect.objectContaining({
          connection: expect.objectContaining({ host: "build.example" }),
        }),
      }),
      expect.anything(),
    );
    await session.write("work\r");
    expect(native.write).toHaveBeenCalledWith("work\r");
    const pending = session.close();
    expect(receipt.isCurrent()).toBe(false);
    await Promise.resolve();
    expect(source.release).not.toHaveBeenCalled();
    await session.write("retired\r");
    await session.resize(80, 24);
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(native.resize).not.toHaveBeenCalled();
    closing.resolve();
    await pending;
    expect(source.release).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);
    await registry.close(1);
    expect(registry.size()).toBe(0);
  });

  it("closes a late native PTY before releasing the lease after retirement", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    const pending = deferred<PtySession>();
    const start = vi.fn().mockReturnValue(pending.promise);
    const opening = receipt.open(start, handlers());
    const retired = expect(opening).rejects.toThrow("retired");
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();
    const closing = receipt.close();
    expect(source.release).not.toHaveBeenCalled();
    const native = pty();
    const nativeClose = deferred<void>();
    vi.mocked(native.close).mockReturnValueOnce(nativeClose.promise);
    pending.resolve(native);
    await vi.waitFor(() => expect(native.close).toHaveBeenCalledOnce());
    expect(source.release).not.toHaveBeenCalled();
    nativeClose.resolve();
    await closing;
    await retired;
    expect(source.release).toHaveBeenCalledOnce();
    await registry.close(1);
    expect(registry.size()).toBe(0);
  });

  it("retirement before the opening microtask never starts a native process", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    const start = vi.fn();
    const opening = receipt.open(start, handlers());
    const retired = expect(opening).rejects.toThrow("retired");
    await receipt.close();
    await retired;
    expect(start).not.toHaveBeenCalled();
    expect(source.release).toHaveBeenCalledOnce();
  });

  it("retains a failed native close for an exact retry without releasing or replacing it", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    const native = pty();
    vi.mocked(native.close).mockRejectedValueOnce(new Error("close failed"));
    const session = await receipt.open(async () => native, handlers());
    await expect(session.close()).rejects.toThrow("close failed");
    expect(source.release).not.toHaveBeenCalled();
    expect(registry.size()).toBe(1);
    expect(() => registry.register(1, target())).toThrow("already owned");
    await registry.close(1);
    expect(native.close).toHaveBeenCalledTimes(2);
    expect(source.release).toHaveBeenCalledOnce();
  });

  it("does not repeat native close when only helper release needs retry", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    vi.mocked(source.release).mockRejectedValueOnce(new Error("helper failed"));
    const receipt = registry.register(1, source);
    const native = pty();
    await receipt.open(async () => native, handlers());
    await expect(receipt.close()).rejects.toThrow("helper failed");
    expect(registry.size()).toBe(1);
    await receipt.close();
    expect(native.close).toHaveBeenCalledOnce();
    expect(source.release).toHaveBeenCalledTimes(2);
    await registry.close(1);
    expect(registry.size()).toBe(0);
  });

  it("keeps failed opens retryable and releases a rejected late open after retirement", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    await expect(
      receipt.open(async () => {
        throw new Error("failed");
      }, handlers()),
    ).rejects.toThrow("failed");
    expect(source.release).not.toHaveBeenCalled();
    const pending = deferred<PtySession>();
    const opening = receipt.open(() => pending.promise, handlers());
    const failed = expect(opening).rejects.toThrow("late failed");
    await Promise.resolve();
    const closing = receipt.close();
    pending.reject(new Error("late failed"));
    await failed;
    await closing;
    expect(source.release).toHaveBeenCalledOnce();
  });

  it("retires before exit callbacks and suppresses all old frames and late closes after replacement", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    const receipt = registry.register(1, source);
    let captured!: PtyHandlers;
    const callbacks = handlers();
    const session = await receipt.open(async (_target, sink) => {
      captured = sink;
      return pty();
    }, callbacks);
    captured.onData(new Uint8Array([1]));
    captured.onExit?.(0);
    expect(receipt.isCurrent()).toBe(false);
    await receipt.close();
    await registry.close(1);
    const replacementTarget = target();
    const replacement = registry.register(1, replacementTarget);
    captured.onData(new Uint8Array([2]));
    captured.onResize?.(80, 24);
    captured.onExit?.(1);
    await session.close();
    expect(callbacks.onData).toHaveBeenCalledTimes(1);
    expect(callbacks.onExit).toHaveBeenCalledExactlyOnceWith(0);
    expect(callbacks.onResize).not.toHaveBeenCalled();
    expect(replacement.isCurrent()).toBe(true);
    expect(replacementTarget.release).not.toHaveBeenCalled();
    await replacement.close();
  });

  it("retains capacity through pending opens and failed cleanup", async () => {
    const registry = createOwnedPtyTargets(1);
    const source = target();
    vi.mocked(source.release).mockRejectedValueOnce(
      new Error("release failed"),
    );
    const receipt = registry.register(1, source);
    await expect(receipt.close()).rejects.toThrow("release failed");
    expect(() => registry.register(2, target())).toThrow("limit");
    await registry.close(1);
    const replacement = registry.register(2, target());
    await replacement.close();
  });

  it("coalesces close before invoking a reentrant release callback", async () => {
    const registry = createOwnedPtyTargets();
    const source = target();
    let second: Promise<void> | undefined;
    const receipt = registry.register(1, source);
    vi.mocked(source.release).mockImplementation(async () => {
      second = receipt.close();
    });
    const first = receipt.close();
    await first;
    expect(second).toBe(first);
    expect(source.release).toHaveBeenCalledOnce();
  });
});
