import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarnessViewCreation } from "@/modules/harness/lib/harnessViewCreation";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import type { HarnessNavigationView } from "@/modules/harness/lib/harnessWindowNavigation";

function fixture() {
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing creation permit");
  const creator = createHarnessViewCreation();
  const open = vi.fn(() => 7);
  const view: HarnessNavigationView = {
    ownerId: 7,
    isCurrent: vi.fn(() => true),
    release: vi.fn(),
  };
  return { authority, owner, permit, creator, open, view };
}
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

it("coalesces creations and waits for a live exact-owner registration", async () => {
  const f = fixture();
  const one = f.creator.create(f.open, f.permit);
  const two = f.creator.create(f.open, f.permit);
  let settled = false;
  void one.then(() => {
    settled = true;
  });
  f.creator.registered({ ...f.view, ownerId: 8 });
  await Promise.resolve();
  expect(settled).toBe(false);
  f.creator.registered(f.view);
  expect(await one).toBe(f.view);
  expect(await two).toBe(f.view);
  expect(f.open).toHaveBeenCalledOnce();
  expect(f.view.release).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores the retired first StrictMode registration and waits for its replacement", async () => {
  const f = fixture();
  const pending = f.creator.create(f.open, f.permit);
  let live = true;
  f.creator.registered({ ...f.view, isCurrent: () => live });
  live = false;
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  const replacement = { ...f.view };
  f.creator.registered(replacement);
  expect(await pending).toBe(replacement);
});

it("retains each original permit through close cancellation and shared creation", async () => {
  const f = fixture();
  const old = f.creator.create(f.open, f.permit);
  const closer = f.authority.createOwner();
  const final = closer.capture()?.seal();
  if (!final) throw new Error("Missing close seal");
  final.cancel();
  const fresh = f.owner.capture();
  if (!fresh) throw new Error("Missing fresh permit");
  const current = f.creator.create(f.open, fresh);
  f.creator.registered(f.view);
  expect(await old).toBeNull();
  expect(await current).toBe(f.view);
  expect(f.open).toHaveBeenCalledOnce();
});

it("bounds waiters including expired ones and frees the timer at the deadline", async () => {
  const f = fixture();
  const pending = Array.from({ length: 256 }, () =>
    f.creator.create(f.open, f.permit),
  );
  f.owner.retire();
  const fresh = f.authority.createOwner().capture();
  if (!fresh) throw new Error("Missing fresh permit");
  expect(await f.creator.create(f.open, fresh)).toBeNull();
  expect(f.open).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await Promise.all(pending)).every((view) => view === null)).toBe(
    true,
  );
  expect(vi.getTimerCount()).toBe(0);
  const next = f.creator.create(f.open, fresh);
  f.creator.registered(f.view);
  expect(await next).toBe(f.view);
  expect(f.open).toHaveBeenCalledTimes(2);
});

it.each(["removal", "dispose"] as const)(
  "settles and fences late registrations after %s",
  async (cause) => {
    const f = fixture();
    const pending = f.creator.create(f.open, f.permit);
    if (cause === "removal") f.creator.observeTabs([]);
    else f.creator.dispose();
    f.creator.registered(f.view);
    expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    if (cause === "dispose") {
      expect(await f.creator.create(f.open, f.permit)).toBeNull();
      expect(f.open).toHaveBeenCalledOnce();
    }
  },
);

it("fails closed before allocation for expired requests and recovers after a callback throws", async () => {
  const f = fixture();
  f.owner.retire();
  expect(await f.creator.create(f.open, f.permit)).toBeNull();
  expect(f.open).not.toHaveBeenCalled();
  const fresh = f.authority.createOwner().capture();
  if (!fresh) throw new Error("Missing fresh permit");
  const failure = vi.fn(() => {
    throw new Error("Cannot create tab");
  });
  expect(await f.creator.create(failure, fresh)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  const pending = f.creator.create(f.open, fresh);
  f.creator.registered(f.view);
  expect(await pending).toBe(f.view);
});

it("publishes admission before a reentrant tab callback", async () => {
  const f = fixture();
  let reentrant: Promise<HarnessNavigationView | null> | undefined;
  const pending = f.creator.create(() => {
    reentrant = f.creator.create(f.open, f.permit);
    f.creator.registered(f.view);
    return 7;
  }, f.permit);
  expect(await pending).toBe(f.view);
  expect(await reentrant).toBe(f.view);
  expect(f.open).not.toHaveBeenCalled();
});
