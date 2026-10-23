import { expect, it, vi } from "vitest";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import { newSession } from "@/modules/harness/lib/session";
import { newTab } from "@/modules/harness/lib/layout";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";

function fixture() {
  const holds = createHarnessWindowSessionHolds();
  const views = createHarnessWindowViews(holds);
  const session = newSession("cursor", "/work/project");
  const tab = newTab(session.id);
  const input = {
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: session.cwd,
    projectReturnMemory: new Map([[session.cwd, session.id]]),
    projectTerminals: [],
    report: normalizeHarnessSessionViewReport({
      referencedSessionIds: [session.id],
    }),
  };
  return { holds, views, session, tab, input };
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing reference admission fixture");
  return value;
}

it.each(["removing", "transfer"] as const)(
  "rejects a new owner during %s without changing cohorts or notifying observers",
  (kind) => {
    const f = fixture();
    const hold = required(f.holds.acquire(kind, [f.session.id], () => true));
    const before = f.views.getSnapshot();
    const changed = vi.fn();
    f.views.subscribe(changed);
    expect(() => f.views.register(1, f.input)).toThrow(
      "Harness reference is reserved",
    );
    expect(f.views.getSnapshot()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    hold.release();
    expect(f.views.register(1, f.input).isCurrent()).toBe(true);
  },
);

it("allows an incumbent to publish changes and remove references while refusing a new reference", () => {
  const f = fixture();
  const owner = f.views.register(1, f.input);
  const other = newSession("cursor", "/work/other");
  const held = required(
    f.holds.acquire("removing", [f.session.id, other.id], () => true),
  );
  owner.update({ ...f.input, projectCwd: "/work/renamed" });
  expect(f.views.getSnapshot().cohorts[0].state.layout.projectCwd).toBe(
    "/work/renamed",
  );
  const before = f.views.getSnapshot();
  expect(() =>
    owner.update({
      ...f.input,
      report: normalizeHarnessSessionViewReport({
        referencedSessionIds: [f.session.id, other.id],
      }),
    }),
  ).toThrow("Harness reference is reserved");
  expect(f.views.getSnapshot()).toBe(before);
  owner.update({
    ...f.input,
    tabs: [],
    projectReturnMemory: new Map(),
    report: normalizeHarnessSessionViewReport({ referencedSessionIds: [] }),
  });
  expect(() => owner.update(f.input)).toThrow("Harness reference is reserved");
  held.release();
  owner.update(f.input);
  expect(
    f.views.getSnapshot().cohorts[0].state.report.referencedSessionIds,
  ).toEqual([f.session.id]);
});

it.each([1, 2])(
  "refuses restoration into owner %s while held without losing the retained cohort",
  (ownerId) => {
    const f = fixture();
    f.views.register(1, f.input).release();
    const before = f.views.getSnapshot();
    const cohort = required(before.cohorts[0]);
    const held = required(
      f.holds.acquire("transfer", [f.session.id], () => true),
    );
    expect(() => f.views.restore(ownerId, cohort)).toThrow(
      "Harness reference is reserved",
    );
    expect(f.views.getSnapshot()).toBe(before);
    held.release();
    expect(required(f.views.restore(ownerId, cohort)).isCurrent()).toBe(true);
  },
);

it("does not lend an incumbent's reference rights to a replacement registration", () => {
  const f = fixture();
  const incumbent = f.views.register(1, f.input);
  const before = f.views.getSnapshot();
  required(f.holds.acquire("removing", [f.session.id], () => true));
  expect(() => f.views.register(1, f.input)).toThrow(
    "Harness reference is reserved",
  );
  expect(f.views.getSnapshot()).toBe(before);
  expect(incumbent.isCurrent()).toBe(true);
});

it("keeps a retired operation fenced until its physical reservation releases", () => {
  const f = fixture();
  let current = true;
  const held = required(
    f.holds.acquire("removing", [f.session.id], () => current),
  );
  current = false;
  expect(held.isCurrent()).toBe(false);
  expect(() => f.views.register(1, f.input)).toThrow(
    "Harness reference is reserved",
  );
  held.release();
  expect(f.views.register(1, f.input).isCurrent()).toBe(true);
});

it.each(["opening", "switching"] as const)(
  "allows ordinary registration under a %s hold",
  (kind) => {
    const f = fixture();
    required(f.holds.acquire(kind, [f.session.id], () => true));
    expect(f.views.register(1, f.input).isCurrent()).toBe(true);
  },
);

it("does not rely on the report to discover layout and return-memory references", () => {
  const f = fixture();
  required(f.holds.acquire("removing", [f.session.id], () => true));
  expect(() =>
    f.views.register(1, {
      ...f.input,
      report: normalizeHarnessSessionViewReport({ referencedSessionIds: [] }),
      projectReturnMemory: new Map(),
    }),
  ).toThrow("Harness reference is reserved");
  expect(() =>
    f.views.register(1, {
      ...f.input,
      tabs: [],
      report: normalizeHarnessSessionViewReport({ referencedSessionIds: [] }),
    }),
  ).toThrow("Harness reference is reserved");
});

it("checks reservations after normalizing caller-owned metadata", () => {
  const f = fixture();
  const before = f.views.getSnapshot();
  expect(() =>
    f.views.register(1, {
      ...f.input,
      keepTab: () => {
        required(f.holds.acquire("removing", [f.session.id], () => true));
        return true;
      },
    }),
  ).toThrow("Harness reference is reserved");
  expect(f.views.getSnapshot()).toBe(before);
});

it("does not treat remembered navigation as permission to open a conversation during removal", () => {
  const f = fixture();
  const view = f.views.register(1, {
    ...f.input,
    tabs: [],
    report: normalizeHarnessSessionViewReport({ referencedSessionIds: [] }),
  });
  required(f.holds.acquire("removing", [f.session.id], () => true));
  const before = f.views.getSnapshot();
  expect(() => view.update(f.input)).toThrow("Harness reference is reserved");
  expect(f.views.getSnapshot()).toBe(before);
});

it("does not let a reentrant retired update overwrite its replacement", () => {
  const f = fixture();
  const original = f.views.register(1, f.input);
  original.update({
    ...f.input,
    keepTab: () => {
      f.views.register(1, { ...f.input, projectCwd: "/work/replacement" });
      return true;
    },
  });
  expect(original.isCurrent()).toBe(false);
  expect(f.views.getSnapshot().cohorts[0].state.layout.projectCwd).toBe(
    "/work/replacement",
  );
});
