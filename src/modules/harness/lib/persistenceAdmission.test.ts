import { describe, expect, it, vi } from "vitest";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Expected persistence test fixture value to be present");
  }
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

describe("window persistence admission", () => {
  it("capacity recovery retries only denied publishers without invalidating healthy dedupe", async () => {
    const authority = createPersistenceAdmission();
    const healthyResume = vi.fn();
    const deniedResume = vi.fn();
    const healthy = authority.createOwner(healthyResume);
    const denied = authority.createOwner(deniedResume);
    const gate = deferred();
    const permit = required(healthy.capture());
    const pending = Array.from({ length: 256 }, () =>
      permit.run(() => gate.promise),
    );
    const write = vi.fn(async () => undefined);
    expect(await required(denied.capture()).run(write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all(pending);
    expect(deniedResume).toHaveBeenCalledOnce();
    expect(healthyResume).not.toHaveBeenCalled();
  });
  it("keeps a later view usable after a previous view retires at large cardinality", () => {
    const authority = createPersistenceAdmission();
    const owners = Array.from({ length: 64 }, () => authority.createOwner());
    const resumed = vi.fn();
    const later = authority.createOwner(resumed);
    owners[0].retire();
    expect(later.capture()).not.toBeNull();
    const final = required(required(owners[1].capture()).seal());
    final.cancel();
    expect(resumed).toHaveBeenCalledOnce();
    for (const owner of owners) owner.retire();
    later.retire();
  });

  it("retains a retired owner's actual write in a sibling's drain", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const sibling = authority.createOwner();
    const gate = deferred();
    const writing = required(owner.capture()).run(() => gate.promise);
    owner.retire();
    const final = required(required(sibling.capture()).seal());
    expect(final.pending).not.toBeNull();
    gate.resolve();
    await writing;
    await final.pending;
    expect(final.isCurrent()).toBe(true);
  });

  it("captures a receipt before reentrant sealing inside its native write", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const gate = deferred();
    let pending: Promise<void> | null = null;
    const writing = required(owner.capture()).run(() => {
      pending = required(required(owner.capture()).seal()).pending;
      return gate.promise;
    });
    expect(pending).not.toBeNull();
    gate.resolve();
    await writing;
    await pending;
  });

  it("a replacement final drains an actual write from a cancelled final", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const gate = deferred();
    const old = required(required(owner.capture()).seal());
    const writing = old.run(() => gate.promise);
    old.cancel();
    const current = required(required(owner.capture()).seal());
    expect(current.pending).not.toBeNull();
    gate.resolve();
    await writing;
    await current.pending;
    expect(current.isCurrent()).toBe(true);
  });
  it.each(["resolve", "reject"] as const)(
    "seals all owners synchronously and retains admitted %s settlement",
    async (outcome) => {
      const authority = createPersistenceAdmission();
      const owner = authority.createOwner();
      const other = authority.createOwner();
      const stale = required(other.capture());
      const gate = deferred();
      const issued = vi.fn(() => gate.promise);
      const writing = stale.run(issued).catch((error: unknown) => error);
      expect(issued).toHaveBeenCalledOnce();
      const final = required(required(owner.capture()).seal());
      expect(final.pending).not.toBeNull();
      expect(other.capture()).toBeNull();
      const late = vi.fn(async () => undefined);
      await stale.run(late);
      expect(late).not.toHaveBeenCalled();
      let settled = false;
      void required(final.pending).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      if (outcome === "resolve") gate.resolve();
      else gate.reject(new Error("write failed"));
      await writing;
      await final.pending;
      expect(settled).toBe(true);
      await final.run(late);
      expect(late).toHaveBeenCalledOnce();
    },
  );

  it("rearms current owners without replaying a pre-seal timer", async () => {
    const authority = createPersistenceAdmission();
    const resumed = vi.fn();
    const owner = authority.createOwner(resumed);
    const old = required(owner.capture());
    const final = required(required(owner.capture()).seal());
    final.cancel();
    expect(resumed).toHaveBeenCalledOnce();
    const write = vi.fn(async () => undefined);
    await old.run(write);
    await final.run(write);
    expect(write).not.toHaveBeenCalled();
    await required(owner.capture()).run(write);
    expect(write).toHaveBeenCalledOnce();
  });

  it("retirement cannot reopen another owner's final admission", () => {
    const authority = createPersistenceAdmission();
    const old = authority.createOwner();
    const selected = authority.createOwner();
    const final = required(required(selected.capture()).seal());
    old.retire();
    expect(final.isCurrent()).toBe(true);
    expect(selected.capture()).toBeNull();
    selected.retire();
    expect(final.isCurrent()).toBe(false);
    expect(authority.createOwner().capture()).not.toBeNull();
  });

  it("a cancelled old final cannot reopen its replacement", () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const old = required(required(owner.capture()).seal());
    old.cancel();
    const current = required(required(owner.capture()).seal());
    old.cancel();
    expect(current.isCurrent()).toBe(true);
    expect(owner.capture()).toBeNull();
  });

  it("bounds pending receipts and recovers capacity only on actual settlement", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const permit = required(owner.capture());
    const gate = deferred();
    const native = vi.fn(() => gate.promise);
    const pending = Array.from({ length: 256 }, () => permit.run(native));
    await permit.run(native);
    expect(native).toHaveBeenCalledTimes(256);
    gate.resolve();
    await Promise.all(pending);
    await permit.run(native);
    expect(native).toHaveBeenCalledTimes(257);
  });

  it("keeps synchronous write errors exact and frees their receipts", async () => {
    const authority = createPersistenceAdmission();
    const owner = authority.createOwner();
    const failure = new Error("write failed");
    await expect(
      required(owner.capture()).run(() => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(required(required(owner.capture()).seal()).pending).toBeNull();
  });
});
