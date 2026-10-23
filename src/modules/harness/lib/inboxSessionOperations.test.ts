import { expect, it, vi } from "vitest";
import { createInboxSessionOperations } from "@/modules/harness/lib/inboxSessionOperations";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";

function fixture() {
  const admission = createPersistenceAdmission();
  const owner = admission.createOwner();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing Inbox permit");
  return {
    admission,
    owner,
    permit,
    operations: createInboxSessionOperations(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("publishes an opening before callbacks and coalesces another view's opening", async () => {
  const f = fixture();
  const gate = deferred<string>();
  const create = vi.fn(() => gate.promise);
  const other = vi.fn(async () => "duplicate");
  const one = f.operations.run("key", "open", f.permit, create);
  const two = f.operations.run("key", "open", f.permit, other);
  await Promise.resolve();
  expect(create).toHaveBeenCalledOnce();
  expect(other).not.toHaveBeenCalled();
  gate.resolve("session");
  expect(await one).toBe("session");
  expect(await two).toBe("session");
});

it("rejects competing restart and open requests while the same key is restarting", async () => {
  const f = fixture();
  const gate = deferred<string>();
  const pending = f.operations.run(
    "key",
    "restart",
    f.permit,
    () => gate.promise,
  );
  const denied = vi.fn(async () => "unexpected");
  await expect(
    f.operations.run("key", "restart", f.permit, denied),
  ).rejects.toThrow("unavailable");
  await expect(
    f.operations.run("key", "open", f.permit, denied),
  ).rejects.toThrow("unavailable");
  expect(denied).not.toHaveBeenCalled();
  gate.resolve("new");
  expect(await pending).toBe("new");
});

it("does not let restart displace an unsettled opening", async () => {
  const f = fixture();
  const gate = deferred<string>();
  const pending = f.operations.run("key", "open", f.permit, () => gate.promise);
  await expect(
    f.operations.run("key", "restart", f.permit, async () => "new"),
  ).rejects.toThrow("unavailable");
  gate.resolve("old");
  expect(await pending).toBe("old");
  expect(
    await f.operations.run("key", "restart", f.permit, async () => "new"),
  ).toBe("new");
});

it("fences the original action and every joined caller independently", async () => {
  const f = fixture();
  const other = f.admission.createOwner();
  const second = other.capture();
  if (!second) throw new Error("Missing second permit");
  const gate = deferred<string>();
  let current = () => false;
  const one = f.operations.run("key", "open", f.permit, async (permit) => {
    current = permit.isCurrent;
    return gate.promise;
  });
  const two = f.operations.run("key", "open", second, async () => "wrong");
  const rejected = expect(two).rejects.toThrow("unavailable");
  await Promise.resolve();
  other.retire();
  expect(current()).toBe(true);
  gate.resolve("session");
  expect(await one).toBe("session");
  await rejected;
  expect(current()).toBe(false);
});

it("retains cancelled physical capacity and rejects reentry until actual settlement", async () => {
  const f = fixture();
  const gate = deferred<string>();
  const pending = Array.from({ length: 256 }, (_, i) =>
    f.operations.run(String(i), "open", f.permit, () => gate.promise),
  );
  const rejected = Promise.all(
    pending.map((entry) => expect(entry).rejects.toThrow("unavailable")),
  );
  await Promise.resolve();
  f.owner.retire();
  const fresh = fixture();
  await expect(
    f.operations.run("0", "open", fresh.permit, async () => "wrong"),
  ).rejects.toThrow("capacity");
  await expect(
    f.operations.run("overflow", "open", fresh.permit, async () => "wrong"),
  ).rejects.toThrow("capacity");
  gate.resolve("retired");
  await rejected;
  expect(
    await f.operations.run("fresh", "open", fresh.permit, async () => "new"),
  ).toBe("new");
});

it("counts coalesced waiters against the same bounded budget", async () => {
  const f = fixture();
  const gate = deferred<string>();
  const pending = Array.from({ length: 256 }, () =>
    f.operations.run("same", "open", f.permit, () => gate.promise),
  );
  await expect(
    f.operations.run("same", "open", f.permit, async () => "overflow"),
  ).rejects.toThrow("capacity");
  gate.resolve("session");
  expect(await Promise.all(pending)).toHaveLength(256);
});

it("retains a retired key until settlement while allowing unrelated conversations", async () => {
  const f = fixture();
  const gate = deferred<string>();
  const pending = f.operations.run(
    "same",
    "open",
    f.permit,
    () => gate.promise,
  );
  const rejected = expect(pending).rejects.toThrow("unavailable");
  await Promise.resolve();
  f.owner.retire();
  const owner = f.admission.createOwner();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing replacement permit");
  const create = vi.fn(async () => "replacement");
  await expect(
    f.operations.run("same", "open", permit, create),
  ).rejects.toThrow("unavailable");
  await expect(
    f.operations.run("same", "restart", permit, create),
  ).rejects.toThrow("unavailable");
  expect(create).not.toHaveBeenCalled();
  expect(
    await f.operations.run("other", "open", permit, async () => "independent"),
  ).toBe("independent");
  gate.resolve("retired");
  await rejected;
  expect(await f.operations.run("same", "open", permit, create)).toBe(
    "replacement",
  );
  expect(create).toHaveBeenCalledOnce();
});

it("retires pending callbacks on disposal and preserves failures without poisoning a retry", async () => {
  const f = fixture();
  const error = new Error("Metadata failed");
  await expect(
    f.operations.run("key", "open", f.permit, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  const create = vi.fn(async () => "unexpected");
  const pending = f.operations.run("key", "open", f.permit, create);
  f.operations.dispose();
  await expect(pending).rejects.toThrow("unavailable");
  expect(create).not.toHaveBeenCalled();
  await expect(
    f.operations.run("key", "open", f.permit, create),
  ).rejects.toThrow("unavailable");
});
