import { expect, it, vi } from "vitest";
import { createHarnessProjectReservations } from "@/modules/harness/lib/harnessProjectReservations";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";

function fixture() {
  const admission = createPersistenceAdmission();
  const owner = admission.createOwner();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing permit");
  return { owner, permit, reservations: createHarnessProjectReservations() };
}
function required<T>(value: T | null) {
  if (!value) throw new Error("Missing reservation");
  return value;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("publishes the whole normalized reservation before reentrant observers", () => {
  const f = fixture();
  let observed = false;
  const unsubscribe = f.reservations.subscribe(() => {
    observed = f.reservations.has("C:\\WORK\\APP\\");
    expect(f.reservations.reserve("c:/work/app", f.permit)).toBeNull();
  });
  const receipt = required(f.reservations.reserve("C:/Work/App/", f.permit));
  expect(observed).toBe(true);
  expect(receipt.isCurrent()).toBe(true);
  unsubscribe();
  receipt.release();
});

it("keeps POSIX and remote roots distinct and normalizes UNC identity", () => {
  const f = fixture();
  for (const path of [
    "/work/App",
    "remote://one/work/app",
    "remote://two/work/app",
    "\\\\server\\Share\\App",
  ])
    required(f.reservations.reserve(path, f.permit));
  expect(f.reservations.has("/work/app")).toBe(false);
  expect(f.reservations.has("//SERVER/share/app/")).toBe(true);
  expect(f.reservations.has("remote://one/work/other")).toBe(false);
});

it.each(["release", "dispose", "cancel"] as const)(
  "retains pending physical work after %s",
  async (action) => {
    const f = fixture();
    const receipt = required(f.reservations.reserve("/work/app", f.permit));
    const gate = deferred();
    const pending = receipt.perform(async () => {
      await gate.promise;
      return true;
    });
    expect(await receipt.perform(async () => true)).toBe(false);
    if (action === "release") receipt.release();
    else if (action === "dispose") f.reservations.dispose();
    else required(f.permit.seal()).cancel();
    expect(receipt.isCurrent()).toBe(false);
    expect(f.reservations.has("/work/app")).toBe(true);
    expect(f.reservations.reserve("/work/app", f.permit)).toBeNull();
    gate.resolve();
    expect(await pending).toBe(false);
    expect(f.reservations.has("/work/app")).toBe(false);
  },
);

it("drains writes independently of caller action and retains successful receipts until release", async () => {
  const f = fixture();
  const receipt = required(f.reservations.reserve("/work/app", f.permit));
  expect(await receipt.perform(async () => true)).toBe(true);
  expect(f.reservations.has("/work/app")).toBe(true);
  const gate = deferred();
  const pending = receipt.run(() => gate.promise);
  const final = required(f.permit.seal());
  expect(final.pending).not.toBeNull();
  receipt.release();
  f.reservations.dispose();
  expect(f.reservations.has("/work/app")).toBe(true);
  gate.resolve();
  expect(await pending).toBe(false);
  await final.pending;
  final.cancel();
  expect(f.reservations.has("/work/app")).toBe(false);
});

it("preserves action failure and allows an explicit retry after settlement", async () => {
  const f = fixture();
  const receipt = required(f.reservations.reserve("/work/app", f.permit));
  const error = new Error("Cleanup failed");
  await expect(
    receipt.perform(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  const replacement = required(f.reservations.reserve("/work/app", f.permit));
  receipt.release();
  expect(replacement.isCurrent()).toBe(true);
});

it("counts retired pending operations against capacity until actual settlement", async () => {
  const f = fixture();
  const gate = deferred();
  const receipts = Array.from({ length: 256 }, (_, i) =>
    required(f.reservations.reserve(`/work/${i}`, f.permit)),
  );
  const pending = receipts.map((receipt) =>
    receipt.perform(async () => {
      await gate.promise;
      return true;
    }),
  );
  for (const receipt of receipts) receipt.release();
  expect(f.reservations.reserve("/overflow", f.permit)).toBeNull();
  gate.resolve();
  expect(await Promise.all(pending)).toEqual(Array(256).fill(false));
  expect(f.reservations.reserve("/fresh", f.permit)).not.toBeNull();
});

it("rejects invalid or retired requests without publishing", () => {
  const f = fixture();
  const listener = vi.fn();
  f.reservations.subscribe(listener);
  for (const path of ["", " ", "a\0b", "x".repeat(4097)])
    expect(() => f.reservations.reserve(path, f.permit)).toThrow(TypeError);
  f.owner.retire();
  expect(f.reservations.reserve("/work/app", f.permit)).toBeNull();
  expect(listener).not.toHaveBeenCalled();
});

it("does not return a reservation retired by its publication callback", () => {
  const f = fixture();
  f.reservations.subscribe(() => f.owner.retire());
  expect(f.reservations.reserve("/work/app", f.permit)).toBeNull();
  expect(f.reservations.has("/work/app")).toBe(false);
});

it("rechecks competing ownership after an authority callback", () => {
  const f = fixture();
  const receipt = f.reservations.reserve("/work/app", {
    ...f.permit,
    isCurrent: () => {
      required(f.reservations.reserve("/work/app", f.permit));
      return true;
    },
  });
  expect(receipt).toBeNull();
  expect(f.reservations.has("/work/app")).toBe(true);
});

it("bounds observers and publishes stable frozen membership", () => {
  const f = fixture();
  const callbacks = Array.from({ length: 256 }, () => vi.fn());
  const unsubscribe = callbacks.map((callback) =>
    f.reservations.subscribe(callback),
  );
  expect(() => f.reservations.subscribe(vi.fn())).toThrow(RangeError);
  unsubscribe[0]();
  const extra = vi.fn();
  f.reservations.subscribe(extra);
  const receipt = required(f.reservations.reserve("/work/app", f.permit));
  const snapshot = f.reservations.getSnapshot();
  expect(snapshot.projectPaths).toEqual(["/work/app"]);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.projectPaths)).toBe(true);
  expect(f.reservations.getSnapshot()).toBe(snapshot);
  expect(callbacks[0]).not.toHaveBeenCalled();
  expect(extra).toHaveBeenCalledOnce();
  receipt.release();
  expect(f.reservations.getSnapshot()).not.toBe(snapshot);
});
