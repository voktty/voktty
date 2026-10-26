import { expect, it, vi } from "vitest";
import { createOwnedShellSessions } from "@/modules/ai/lib/ownedShellSessions";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(limit = 2) {
  const cache = createOwnedShellSessions(limit);
  const owner = {};
  const open = vi.fn(async () => 7);
  const close = vi.fn(async (_id: number) => {});
  const execute = vi.fn(async (id: number) => id);
  const options = { open, close, execute, assertCurrent: () => {} };
  return { cache, owner, open, close, execute, options };
}

it("forgets an unused owner without native work and cannot revive it", async () => {
  const f = fixture();
  await f.cache.retire(f.owner);
  await expect(f.cache.run(f.owner, "source", f.options)).rejects.toThrow(
    "retired",
  );
  expect(f.open).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
});

it("coalesces opening and serializes commands within the exact owner and source", async () => {
  const f = fixture();
  const finish = deferred<number>();
  f.execute.mockImplementationOnce(() => finish.promise);
  const first = f.cache.run(f.owner, "source", f.options);
  const second = f.cache.run(f.owner, "source", f.options);
  await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
  expect(f.open).toHaveBeenCalledTimes(1);
  finish.resolve(1);
  expect(await first).toBe(1);
  expect(await second).toBe(7);
  await f.cache.retire(f.owner);
  expect(f.close).toHaveBeenCalledExactlyOnceWith(7);
});

it("retires before a deferred opening without allocating a native ID", async () => {
  const f = fixture(1);
  const pending = f.cache.run(f.owner, "source", f.options);
  const retired = f.cache.retire(f.owner);
  await expect(pending).rejects.toThrow("retired");
  await retired;
  expect(f.open).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  expect(await f.cache.run({}, "source", f.options)).toBe(7);
});

it("holds pending opens and closes their late original ID before freeing capacity", async () => {
  const f = fixture(1);
  const opening = deferred<number>();
  const closing = deferred<void>();
  f.open.mockReturnValueOnce(opening.promise);
  f.close.mockReturnValueOnce(closing.promise);
  const pending = f.cache.run(f.owner, "source", f.options);
  const observed = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(f.open).toHaveBeenCalledTimes(1));
  const retired = f.cache.retire(f.owner);
  await expect(f.cache.run({}, "other", f.options)).rejects.toThrow("Too many");
  opening.resolve(11);
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledExactlyOnceWith(11));
  expect(f.execute).not.toHaveBeenCalled();
  await expect(f.cache.run({}, "other", f.options)).rejects.toThrow("Too many");
  closing.resolve();
  await Promise.all([observed, retired]);
  expect(await f.cache.run({}, "other", f.options)).toBe(7);
});

it("waits for an admitted command, rejects the old queue and only then closes metadata", async () => {
  const f = fixture(1);
  const running = deferred<number>();
  f.execute.mockReturnValueOnce(running.promise);
  const first = f.cache.run(f.owner, "source", f.options);
  const second = f.cache.run(f.owner, "source", f.options);
  const outcomes = Promise.allSettled([first, second]);
  await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
  const retired = f.cache.retire(f.owner);
  expect(f.close).not.toHaveBeenCalled();
  await expect(f.cache.run({}, "other", f.options)).rejects.toThrow("Too many");
  running.resolve(7);
  expect((await outcomes).map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  await retired;
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledExactlyOnceWith(7);
});

it("retains failed cleanup and retries the same captured ID without closing a successor", async () => {
  const f = fixture(1);
  const failure = new Error("close failed");
  await f.cache.run(f.owner, "source", f.options);
  f.close.mockRejectedValueOnce(failure);
  await expect(f.cache.retire(f.owner)).rejects.toBe(failure);
  await f.cache.retire(f.owner);
  expect(f.close.mock.calls).toEqual([[7], [7]]);
  const replacement = {};
  await f.cache.run(replacement, "source", f.options);
  await f.cache.retire(f.owner);
  expect(f.close).toHaveBeenCalledTimes(2);
  await f.cache.retire(replacement);
  expect(f.close).toHaveBeenCalledTimes(3);
});

it("coalesces concurrent retirement attempts before native callbacks", async () => {
  const f = fixture();
  await f.cache.run(f.owner, "source", f.options);
  const closing = deferred<void>();
  f.close.mockReturnValueOnce(closing.promise);
  const first = f.cache.retire(f.owner);
  const second = f.cache.retire(f.owner);
  expect(second).toBe(first);
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledTimes(1));
  closing.resolve();
  await Promise.all([first, second]);
});

it("settles every captured closer before reporting failure", async () => {
  const f = fixture();
  await f.cache.run(f.owner, "first", f.options);
  f.open.mockResolvedValueOnce(8);
  await f.cache.run(f.owner, "second", f.options);
  const closing = deferred<void>();
  f.close
    .mockRejectedValueOnce(new Error("first failed"))
    .mockReturnValueOnce(closing.promise);
  let finished = false;
  const retired = f.cache.retire(f.owner).then(
    () => {
      finished = true;
    },
    (error) => {
      finished = true;
      throw error;
    },
  );
  const outcome = expect(retired).rejects.toThrow("first failed");
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledTimes(2));
  expect(finished).toBe(false);
  closing.resolve();
  await outcome;
  await f.cache.retire(f.owner);
  expect(f.close.mock.calls).toEqual([[7], [8], [7]]);
});

it("retries settled failed cleanup at capacity and revalidates the waiting caller", async () => {
  const f = fixture(1);
  await f.cache.run(f.owner, "old", f.options);
  f.close.mockRejectedValueOnce(new Error("failed"));
  await expect(f.cache.retire(f.owner)).rejects.toThrow("failed");
  const closing = deferred<void>();
  f.close.mockReturnValueOnce(closing.promise);
  const replacement = {};
  const pending = f.cache.run(replacement, "new", f.options);
  const observed = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledTimes(2));
  await f.cache.retire(replacement);
  closing.resolve();
  await observed;
  expect(f.open).toHaveBeenCalledTimes(1);
});

it("does not block unrelated capacity on a retry whose native close remains pending", async () => {
  const f = fixture(2);
  await f.cache.run(f.owner, "old", f.options);
  f.close.mockRejectedValueOnce(new Error("failed"));
  await expect(f.cache.retire(f.owner)).rejects.toThrow("failed");
  const closing = deferred<void>();
  f.close.mockReturnValueOnce(closing.promise);
  expect(await f.cache.run({}, "new", f.options)).toBe(7);
  expect(f.close).toHaveBeenCalledTimes(2);
  closing.resolve();
});

it("reclaims failed opening by exact identity and admits a healthy retry", async () => {
  const f = fixture(1);
  f.open.mockRejectedValueOnce(new Error("open failed"));
  await expect(f.cache.run(f.owner, "source", f.options)).rejects.toThrow(
    "open failed",
  );
  expect(await f.cache.run(f.owner, "source", f.options)).toBe(7);
  await f.cache.retire(f.owner);
  expect(f.close).toHaveBeenCalledTimes(1);
});

it("publishes resource ownership before reentrant opening retirement", async () => {
  const f = fixture(1);
  let retired!: Promise<void>;
  f.open.mockImplementationOnce(async () => {
    retired = f.cache.retire(f.owner);
    return 7;
  });
  await expect(f.cache.run(f.owner, "source", f.options)).rejects.toThrow(
    "retired",
  );
  await retired;
  expect(f.close).toHaveBeenCalledExactlyOnceWith(7);
  expect(f.execute).not.toHaveBeenCalled();
  expect(await f.cache.run({}, "new", f.options)).toBe(7);
});

it("does not make a healthy caller inherit a retired pre-open admission", async () => {
  const f = fixture(1);
  let cancelled = false;
  const first = f.cache.run(f.owner, "source", {
    ...f.options,
    assertCurrent: () => {
      if (cancelled) throw new Error("request retired");
    },
  });
  cancelled = true;
  const second = f.cache.run(f.owner, "source", f.options);
  await expect(first).rejects.toThrow("retired");
  expect(await second).toBe(7);
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.execute).toHaveBeenCalledTimes(1);
  await f.cache.retire(f.owner);
});

it("captures callbacks before any asynchronous opening stage", async () => {
  const f = fixture();
  const options = { ...f.options };
  const pending = f.cache.run(f.owner, "source", options);
  options.open = vi.fn(async () => 99);
  options.close = vi.fn(async () => {});
  options.execute = vi.fn(async () => 99);
  options.assertCurrent = () => {
    throw new Error("replacement callback");
  };
  expect(await pending).toBe(7);
  await f.cache.retire(f.owner);
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.execute).toHaveBeenCalledExactlyOnceWith(7);
  expect(f.close).toHaveBeenCalledExactlyOnceWith(7);
  expect(options.open).not.toHaveBeenCalled();
  expect(options.close).not.toHaveBeenCalled();
  expect(options.execute).not.toHaveBeenCalled();
});
