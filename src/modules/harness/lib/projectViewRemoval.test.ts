import { expect, it } from "vitest";
import { createHarnessProjectReservations } from "@/modules/harness/lib/harnessProjectReservations";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { createHarnessWindowViewRemoval } from "@/modules/harness/lib/harnessWindowViewRemoval";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";

function required<T>(value: T | null | undefined) {
  if (value == null) throw new Error("Missing project scope fixture");
  return value;
}

it("refuses another caller's permit even when the project is reserved", async () => {
  const f = fixture();
  f.views.register(1, f.input).release();
  const project = required(f.projects.reserve("c:/work/app", f.permit));
  expect(
    await f.removals.prepare(null, [], f.permit, "removing", {
      path: "c:/work/app",
      owner: f.permit,
    }),
  ).toBeNull();
  expect(
    f.views.pruneRetained(
      f.views.getSnapshot().cohorts[0],
      [],
      f.permit.isCurrent,
      { path: "c:/work/app", owner: f.permit },
    ),
  ).toBeNull();
  expect(f.projects.owns("c:/work/app", project)).toBe(true);
  project.release();
});
function fixture() {
  const projects = createHarnessProjectReservations();
  const holds = createHarnessWindowSessionHolds();
  const views = createHarnessWindowViews(holds, projects);
  const removals = createHarnessWindowViewRemoval(views, holds, projects);
  const permit = required(createPersistenceAdmission().createOwner().capture());
  const input = {
    tabs: [],
    activeTabId: "",
    projectCwd: "C:/Work/App",
    projectTerminals: [],
    projectReturnMemory: new Map([["c:/work/app", "physical-pane"]]),
    report: {
      referencedSessionIds: [],
      foregroundSessionIds: [],
      activeSessionId: null,
    },
  };
  return { projects, holds, views, removals, permit, input };
}

it("bounds unsettled metadata-only preparations without relying on session ID capacity", async () => {
  const f = fixture();
  const project = required(f.projects.reserve("/work/empty", f.permit));
  const scope = { path: "/work/empty", owner: project };
  const receipts = [];
  for (let i = 0; i < 256; i++)
    receipts.push(
      required(await f.removals.prepare(null, [], project, "removing", scope)),
    );
  expect(
    await f.removals.prepare(null, [], project, "removing", scope),
  ).toBeNull();
  receipts[0].release();
  const replacement = required(
    await f.removals.prepare(null, [], project, "removing", scope),
  );
  replacement.release();
  for (const receipt of receipts) receipt.release();
  project.release();
});

it("requires a live project reservation before admitting an empty-session project scope", async () => {
  const f = fixture();
  f.views.register(1, f.input).release();
  expect(
    await f.removals.prepare(null, [], f.permit, "removing", {
      path: "c:/work/app",
      owner: f.permit,
    }),
  ).toBeNull();
  const project = required(f.projects.reserve("c:/work/app", f.permit));
  const operation = required(
    await f.removals.prepare(null, [], project, "removing", {
      path: "c:/work/app",
      owner: project,
    }),
  );
  expect(await operation.commit()).toBe(true);
  expect(f.views.getSnapshot().cohorts[0].state.layout.projectCwd).toBe("~");
  expect(f.views.getSnapshot().cohorts[0].state.returnTargets).toEqual([]);
  operation.release();
  project.release();
});

it("vetoes the operation if a metadata-only participant cannot prepare", async () => {
  const f = fixture();
  f.views.register(1, f.input);
  const project = required(f.projects.reserve("c:/work/app", f.permit));
  const before = f.views.getSnapshot();
  expect(
    await f.removals.prepare(null, [], project, "removing", {
      path: "c:/work/app",
      owner: project,
    }),
  ).toBeNull();
  expect(f.views.getSnapshot()).toBe(before);
  project.release();
});

it("prevents new or restored project navigation until physical project release", () => {
  const f = fixture();
  const handle = f.views.register(1, f.input);
  handle.release();
  const retained = f.views.getSnapshot().cohorts[0];
  const project = required(f.projects.reserve("c:/work/app", f.permit));
  expect(() => f.views.restore(2, retained)).toThrow("reserved");
  expect(() => f.views.register(2, f.input)).toThrow("reserved");
  project.release();
  expect(f.views.restore(2, retained)).not.toBeNull();
});

it("prevents a new return target from reintroducing a reserved project into another view", () => {
  const f = fixture();
  const handle = f.views.register(1, {
    ...f.input,
    projectCwd: "/other",
    projectReturnMemory: new Map(),
  });
  const project = required(f.projects.reserve("c:/work/app", f.permit));
  expect(() => handle.update({ ...f.input, projectCwd: "/other" })).toThrow(
    "reserved",
  );
  project.release();
  expect(() =>
    handle.update({ ...f.input, projectCwd: "/other" }),
  ).not.toThrow();
});
