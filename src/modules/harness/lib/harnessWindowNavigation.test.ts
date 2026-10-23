import { describe, expect, it, vi } from "vitest";
import {
  createHarnessWindowNavigation,
  type HarnessNavigationView,
} from "@/modules/harness/lib/harnessWindowNavigation";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { newTab } from "@/modules/harness/lib/layout";
import {
  createPersistenceAdmission,
  type PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing navigation fixture");
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const views = createHarnessWindowViews();
  const router = createHarnessWindowNavigation(views);
  const authority = createPersistenceAdmission();
  const source = authority.createOwner();
  const add = (ownerId: number, id: string) => {
    const tab = newTab(id);
    const input = {
      tabs: [tab],
      activeTabId: tab.id,
      projectCwd: `/project/${ownerId}`,
      projectReturnMemory: new Map<string, string>(),
      projectTerminals: [],
      report: {
        referencedSessionIds: [id],
        foregroundSessionIds: [],
        activeSessionId: null,
      },
    };
    const view = views.register(ownerId, input);
    const owner = authority.createOwner();
    const open = vi.fn(async (_id: string, _permit: PersistencePermit) => true);
    const activate = vi.fn(() => true);
    const target = {
      isCurrent: view.isCurrent,
      capture: owner.capture,
      openSession: open,
      activate,
    };
    const binding = required(router.register(ownerId, target));
    return { view, owner, open, activate, binding, target, input };
  };
  return {
    views,
    router,
    authority,
    source,
    request: () => required(source.capture()),
    add,
  };
}

describe("window Harness navigation", () => {
  it("prefers a view already showing the session over the selected view", async () => {
    const f = fixture();
    const selected = f.add(1, "other");
    const owning = f.add(2, "session");
    f.views.select(1);
    const create = vi.fn();
    expect(await f.router.openSession("session", f.request(), create)).toBe(
      true,
    );
    expect(owning.open).toHaveBeenCalledOnce();
    expect(owning.activate).toHaveBeenCalledOnce();
    expect(selected.open).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("prefers the selected owner among views showing the same session", async () => {
    const f = fixture();
    const one = f.add(1, "session");
    const two = f.add(2, "session");
    f.views.select(2);
    expect(await f.router.openSession("session", f.request())).toBe(true);
    expect(two.open).toHaveBeenCalledOnce();
    expect(one.open).not.toHaveBeenCalled();
  });

  it("uses the selected view for an unopened session and otherwise the lowest owner", async () => {
    const f = fixture();
    const two = f.add(2, "two");
    const one = f.add(1, "one");
    f.views.select(2);
    expect(await f.router.openSession("new", f.request())).toBe(true);
    expect(two.open).toHaveBeenCalledOnce();
    f.views.select(null);
    expect(await f.router.openSession("newer", f.request())).toBe(true);
    expect(one.open).toHaveBeenCalledOnce();
  });

  it("does not activate a declined navigation or create a competing view", async () => {
    const f = fixture();
    const target = f.add(1, "one");
    target.open.mockResolvedValue(false);
    const create = vi.fn();
    expect(await f.router.openSession("new", f.request(), create)).toBe(false);
    expect(target.activate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    "view",
    "binding",
    "owner",
    "source",
    "close cancellation",
  ] as const)(
    "retires an opening after its %s changes without activating a replacement",
    async (retirement) => {
      const f = fixture();
      const target = f.add(1, "one");
      const gate = deferred<boolean>();
      target.open.mockReturnValueOnce(gate.promise);
      const pending = f.router.openSession("one", f.request());
      const permit = required(target.open.mock.calls[0])[1];
      if (retirement === "view") target.view.release();
      if (retirement === "binding") {
        required(f.router.register(1, target.target));
        target.binding.release();
        expect(f.router.hasTarget()).toBe(true);
      }
      if (retirement === "owner") target.owner.retire();
      if (retirement === "source") f.source.retire();
      if (retirement === "close cancellation") {
        const closer = f.authority.createOwner();
        required(required(closer.capture()).seal()).cancel();
      }
      const write = vi.fn(async () => {});
      expect(permit.isCurrent()).toBe(false);
      expect(await permit.run(write)).toBe(false);
      expect(write).not.toHaveBeenCalled();
      gate.resolve(true);
      expect(await pending).toBe(false);
      expect(target.activate).not.toHaveBeenCalled();
    },
  );

  it("keeps an exact view token current across layout updates and retires it on replacement", async () => {
    const f = fixture();
    const target = f.add(1, "one");
    target.view.update({ ...target.input, projectCwd: "/renamed" });
    expect(target.view.isCurrent()).toBe(true);
    expect(await f.router.openSession("one", f.request())).toBe(true);
    f.views.register(1, target.input);
    expect(target.view.isCurrent()).toBe(false);
    expect(f.router.hasTarget()).toBe(false);
  });

  it("accepts a created view only after its exact navigation registration", async () => {
    const f = fixture();
    const gate = deferred<HarnessNavigationView | null>();
    const create = vi.fn(() => gate.promise);
    const pending = f.router.openSession("one", f.request(), create);
    const target = f.add(1, "one");
    expect(target.open).not.toHaveBeenCalled();
    gate.resolve(target.binding);
    expect(await pending).toBe(true);
    expect(target.open).toHaveBeenCalledOnce();
    expect(target.activate).toHaveBeenCalledOnce();
  });

  it("rejects a fabricated creation receipt even when its owner id exists", async () => {
    const f = fixture();
    const gate = deferred<HarnessNavigationView | null>();
    const pending = f.router.openSession(
      "one",
      f.request(),
      () => gate.promise,
    );
    const target = f.add(1, "one");
    gate.resolve({ ownerId: 1, release: () => {} });
    expect(await pending).toBe(false);
    expect(target.open).not.toHaveBeenCalled();
  });

  it("never revives an expired request after view creation settles", async () => {
    const f = fixture();
    const gate = deferred<HarnessNavigationView | null>();
    const pending = f.router.openSession(
      "one",
      f.request(),
      () => gate.promise,
    );
    f.source.retire();
    const target = f.add(1, "one");
    gate.resolve(target.binding);
    expect(await pending).toBe(false);
    expect(target.open).not.toHaveBeenCalled();
  });

  it("releases admission after a failed creation and denies duplicate in-flight requests", async () => {
    const f = fixture();
    const gate = deferred<HarnessNavigationView | null>();
    const pending = f.router.openSession(
      "one",
      f.request(),
      () => gate.promise,
    );
    const duplicate = vi.fn();
    expect(await f.router.openSession("one", f.request(), duplicate)).toBe(
      false,
    );
    expect(duplicate).not.toHaveBeenCalled();
    gate.resolve(null);
    expect(await pending).toBe(false);
    const target = f.add(1, "one");
    expect(await f.router.openSession("one", f.request())).toBe(true);
    expect(target.open).toHaveBeenCalledOnce();
  });

  it("counts expired operations until settlement and enforces its shared capacity", async () => {
    const f = fixture();
    const target = f.add(1, "one");
    const gate = deferred<boolean>();
    target.open.mockReturnValue(gate.promise);
    const request = f.request();
    const pending = Array.from({ length: 256 }, (_, i) =>
      f.router.openSession(`session-${i}`, request),
    );
    f.source.retire();
    const fresh = required(f.authority.createOwner().capture());
    try {
      expect(await f.router.openSession("overflow", fresh)).toBe(false);
      expect(target.open).toHaveBeenCalledTimes(256);
    } finally {
      gate.resolve(true);
      expect((await Promise.all(pending)).every((opened) => !opened)).toBe(
        true,
      );
    }
    expect(await f.router.openSession("overflow", fresh)).toBe(true);
  });

  it("releases the request slot after a rejected creator", async () => {
    const f = fixture();
    const error = new Error("View creation failed");
    await expect(
      f.router.openSession("one", f.request(), async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const target = f.add(1, "one");
    expect(await f.router.openSession("one", f.request())).toBe(true);
    expect(target.open).toHaveBeenCalledOnce();
  });

  it("admits only actual writes to the close drain and never lends sealing authority", async () => {
    const f = fixture();
    const target = f.add(1, "one");
    const gate = deferred<void>();
    let permit: PersistencePermit | undefined;
    target.open.mockImplementationOnce(async (_id, captured) => {
      permit = captured;
      await captured.run(() => gate.promise);
      return true;
    });
    const pending = f.router.openSession("one", f.request());
    expect(required(permit).seal()).toBeNull();
    const closer = f.authority.createOwner();
    const final = required(required(closer.capture()).seal());
    expect(final.pending).not.toBeNull();
    gate.resolve();
    await final.pending;
    expect(await pending).toBe(false);
    expect(target.activate).not.toHaveBeenCalled();
  });
});
