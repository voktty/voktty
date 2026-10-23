import { expect, it, vi } from "vitest";
import {
  createHarnessWindowViewRemoval,
  type PreparedHarnessViewRemoval,
} from "@/modules/harness/lib/harnessWindowViewRemoval";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import {
  createPersistenceAdmission,
  type PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import { newTab } from "@/modules/harness/lib/layout";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing coordinated removal fixture");
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
  const holds = createHarnessWindowSessionHolds();
  const views = createHarnessWindowViews(holds);
  const removal = createHarnessWindowViewRemoval(views, holds);
  const admission = createPersistenceAdmission();
  const source = admission.createOwner();
  const input = () => {
    const tab = newTab("one");
    return {
      tabs: [tab],
      activeTabId: tab.id,
      projectCwd: "/work",
      projectReturnMemory: new Map<string, string>(),
      projectTerminals: [],
      report: normalizeHarnessSessionViewReport({
        referencedSessionIds: ["one"],
      }),
    };
  };
  views.register(1, input());
  const add = (ownerId: number) => {
    const state = input();
    const view = views.register(ownerId, state);
    const owner = admission.createOwner();
    const commit = vi.fn(async () => {
      view.update({
        ...state,
        tabs: [],
        report: normalizeHarnessSessionViewReport({ referencedSessionIds: [] }),
      });
      return true;
    });
    const prepare = vi.fn(
      async (
        _ids: readonly string[],
        permit: PersistencePermit,
      ): Promise<PreparedHarnessViewRemoval | null> => ({
        isCurrent: permit.isCurrent,
        commit,
      }),
    );
    const target = {
      isCurrent: view.isCurrent,
      capture: owner.capture,
      prepare,
    };
    const receipt = required(removal.register(ownerId, target));
    return { state, view, owner, commit, prepare, target, receipt };
  };
  return {
    holds,
    views,
    removal,
    admission,
    source,
    input,
    add,
    request: () => required(source.capture()),
  };
}

it("prepares every other view before committing, with a reservation retained for global persistence", async () => {
  const f = fixture();
  const one = f.add(2);
  const two = f.add(3);
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  expect(one.prepare).toHaveBeenCalledOnce();
  expect(two.prepare).toHaveBeenCalledOnce();
  expect(one.commit).not.toHaveBeenCalled();
  expect(two.commit).not.toHaveBeenCalled();
  expect(one.prepare.mock.calls[0][1].seal()).toBeNull();
  expect(await operation.commit()).toBe(true);
  expect(
    f.views.getSnapshot().cohorts.find((entry) => entry.ownerId === 1)?.state
      .report.referencedSessionIds,
  ).toEqual(["one"]);
  expect(f.holds.has("removing", "one")).toBe(true);
  operation.release();
  expect(operation.isCurrent()).toBe(false);
  expect(f.holds.hasAny("one")).toBe(false);
});

it("does not prune retained references or commit another view when preparation is declined", async () => {
  const f = fixture();
  const one = f.add(2);
  const two = f.add(3);
  f.views.register(4, f.input()).release();
  const retained = f.views
    .getSnapshot()
    .cohorts.find((entry) => entry.ownerId === 4);
  two.prepare.mockResolvedValue(null);
  expect(await f.removal.prepare(1, ["one"], f.request())).toBeNull();
  expect(one.commit).not.toHaveBeenCalled();
  expect(f.views.getSnapshot().cohorts).toContain(retained);
  expect(f.holds.hasAny("one")).toBe(false);
});

it("requires a registered removal target for every affected active view", async () => {
  const f = fixture();
  f.views.register(2, f.input());
  expect(await f.removal.prepare(1, ["one"], f.request())).toBeNull();
  expect(f.holds.hasAny("one")).toBe(false);
});

it("waits for physical confirmation even after the cohort has already published its new layout", async () => {
  const f = fixture();
  const target = f.add(2);
  const ack = deferred<boolean>();
  const apply = target.commit.getMockImplementation();
  target.commit.mockImplementation(async () => {
    await apply?.();
    return ack.promise;
  });
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  const pending = operation.commit();
  expect(operation.commit()).toBe(pending);
  await Promise.resolve();
  expect(
    f.views.getSnapshot().cohorts.find((entry) => entry.ownerId === 2)?.state
      .report.referencedSessionIds,
  ).toEqual([]);
  operation.release();
  expect(f.holds.hasAny("one")).toBe(true);
  ack.resolve(true);
  expect(await pending).toBe(false);
  expect(target.commit).toHaveBeenCalledOnce();
  expect(f.holds.hasAny("one")).toBe(false);
});

it("keeps a cancelled preparation counted until its actual settlement", async () => {
  const f = fixture();
  const target = f.add(2);
  const gate = deferred<PreparedHarnessViewRemoval | null>();
  target.prepare.mockReturnValue(gate.promise);
  const pending = f.removal.prepare(1, ["one"], f.request());
  f.source.retire();
  expect(f.holds.hasAny("one")).toBe(true);
  gate.resolve(null);
  expect(await pending).toBeNull();
  expect(f.holds.hasAny("one")).toBe(false);
});

it("retires a captured target on replacement and ignores its old cleanup", async () => {
  const f = fixture();
  const target = f.add(2);
  const gate = deferred<PreparedHarnessViewRemoval | null>();
  target.prepare.mockReturnValueOnce(gate.promise);
  const pending = f.removal.prepare(1, ["one"], f.request());
  required(f.removal.register(2, target.target));
  target.receipt.release();
  gate.resolve({ isCurrent: () => true, commit: target.commit });
  expect(await pending).toBeNull();
  expect(target.commit).not.toHaveBeenCalled();
  expect(await f.removal.prepare(1, ["one"], f.request())).not.toBeNull();
  f.removal.dispose();
  expect(f.holds.hasAny("one")).toBe(false);
});

it("prunes retained cohorts only after active view confirmations succeed", async () => {
  const f = fixture();
  f.add(2);
  f.views.register(3, f.input()).release();
  const retained = f.views
    .getSnapshot()
    .cohorts.find((entry) => entry.ownerId === 3);
  const operation = required(
    await f.removal.prepare(1, ["one"], f.request(), "transfer"),
  );
  expect(f.views.getSnapshot().cohorts).toContain(retained);
  expect(await operation.commit()).toBe(true);
  expect(
    f.views.getSnapshot().cohorts.find((entry) => entry.ownerId === 3)?.state
      .report.referencedSessionIds,
  ).toEqual([]);
  expect(f.holds.has("transfer", "one")).toBe(true);
  operation.release();
});

it("rejects a callback's logical success while it still leaves a reference behind", async () => {
  const f = fixture();
  const target = f.add(2);
  target.commit.mockResolvedValue(true);
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  expect(await operation.commit()).toBe(false);
  expect(f.holds.hasAny("one")).toBe(false);
});

it("releases reservations after a rejected callback and preserves the original error", async () => {
  const f = fixture();
  const target = f.add(2);
  const error = new Error("Cannot prepare");
  target.prepare.mockRejectedValue(error);
  await expect(f.removal.prepare(1, ["one"], f.request())).rejects.toBe(error);
  expect(f.holds.hasAny("one")).toBe(false);
});

it("disposes pending work without releasing its physical reservation prematurely", async () => {
  const f = fixture();
  const target = f.add(2);
  const gate = deferred<PreparedHarnessViewRemoval | null>();
  target.prepare.mockReturnValue(gate.promise);
  const pending = f.removal.prepare(1, ["one"], f.request());
  f.removal.dispose();
  expect(f.holds.hasAny("one")).toBe(true);
  gate.resolve(null);
  expect(await pending).toBeNull();
  expect(f.holds.hasAny("one")).toBe(false);
  expect(await f.removal.prepare(1, ["one"], f.request())).toBeNull();
});

it("owns the prepared callback rather than adopting a caller's later replacement", async () => {
  const f = fixture();
  const target = f.add(2);
  const action = { isCurrent: () => true, commit: target.commit };
  target.prepare.mockResolvedValue(action);
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  const replacement = vi.fn(async () => true);
  action.commit = replacement;
  expect(await operation.commit()).toBe(true);
  expect(target.commit).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
  operation.release();
});

it("does not apply a prepared layout whose original view state has retired", async () => {
  const f = fixture();
  const target = f.add(2);
  let current = true;
  target.prepare.mockResolvedValue({
    isCurrent: () => current,
    commit: target.commit,
  });
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  current = false;
  expect(await operation.commit()).toBe(false);
  expect(target.commit).not.toHaveBeenCalled();
  expect(f.holds.hasAny("one")).toBe(false);
});

it("does not mutate active views if a retained cohort changed after preparation", async () => {
  const f = fixture();
  const target = f.add(2);
  f.views.register(3, f.input()).release();
  const retained = required(
    f.views.getSnapshot().cohorts.find((entry) => entry.ownerId === 3),
  );
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  expect(f.views.retire(retained)).toBe(true);
  expect(await operation.commit()).toBe(false);
  expect(target.commit).not.toHaveBeenCalled();
  expect(f.holds.hasAny("one")).toBe(false);
});

it("preserves the physical shared operation budget and releases every idle receipt on disposal", async () => {
  const f = fixture();
  const pending = await Promise.all(
    Array.from({ length: 256 }, (_, i) =>
      f.removal.prepare(1, [`id-${i}`], f.request()),
    ),
  );
  expect(pending.every((operation) => operation !== null)).toBe(true);
  expect(await f.removal.prepare(1, ["overflow"], f.request())).toBeNull();
  f.removal.dispose();
  expect(f.holds.getSnapshot().sessionIds).toEqual([]);
  expect(pending.every((operation) => operation?.isCurrent() === false)).toBe(
    true,
  );
});

it("admits global writes only after confirmed view commits and retains them through disposal", async () => {
  const f = fixture();
  f.add(2);
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  const gate = deferred<void>();
  const write = vi.fn(() => gate.promise);
  expect(operation.seal()).toBeNull();
  expect(await operation.run(write)).toBe(false);
  expect(write).not.toHaveBeenCalled();
  expect(await operation.commit()).toBe(true);
  const pending = operation.run(write);
  expect(write).toHaveBeenCalledOnce();
  f.removal.dispose();
  expect(f.holds.hasAny("one")).toBe(true);
  gate.resolve();
  expect(await pending).toBe(false);
  expect(f.holds.hasAny("one")).toBe(false);
});

it("includes an admitted global write in the original window close drain", async () => {
  const f = fixture();
  f.add(2);
  const operation = required(await f.removal.prepare(1, ["one"], f.request()));
  expect(await operation.commit()).toBe(true);
  const gate = deferred<void>();
  const pending = operation.run(() => gate.promise);
  const final = required(required(f.admission.createOwner().capture()).seal());
  expect(final.pending).not.toBeNull();
  operation.release();
  expect(f.holds.hasAny("one")).toBe(true);
  gate.resolve();
  await final.pending;
  expect(await pending).toBe(false);
  expect(f.holds.hasAny("one")).toBe(false);
});
