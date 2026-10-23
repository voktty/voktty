import { assert, expect, it } from "vitest";
import type { HarnessTab, TerminalTab, Tab } from "@/modules/tabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import type { WorkspacePlacement } from "@/modules/spaces/lib/spaceGeometry";
import { createTerminalSurfaces } from "@/modules/terminal/lib/terminalSurfaceLayout";
import {
  createTerminalSurfaceAdmission,
  type TerminalAdmissionState,
} from "@/modules/terminal/lib/terminalSurfaceAdmission";

function tree(count: number, id = 100): PaneNode {
  if (count === 1) return { kind: "leaf", id };
  return {
    kind: "split",
    id,
    dir: "row",
    children: [tree(1, id + 1), tree(count - 1, id + 2)],
  };
}
function owner(id = 1, cwd = "/srv/app"): HarnessTab {
  return {
    ...createTabIdentity("main", () => `owner-${id}`),
    id,
    kind: "harness",
    spaceId: "main",
    title: "Harness",
    cwd,
  };
}
function terminal(id: number, count = 1, projectCwd = "/srv/app"): TerminalTab {
  return {
    ...createTabIdentity("main", () => `shell-${id}`),
    id,
    kind: "terminal",
    spaceId: "main",
    title: "shell",
    projectCwd,
    paneTree: tree(count),
    activeLeafId: 100,
  };
}
function fixture(count = 7) {
  const one = owner();
  const visible = terminal(2, count);
  const tabs: Tab[] = [one, visible];
  const surfaces = createTerminalSurfaces();
  const state: TerminalAdmissionState = {
    tabs,
    activeId: one.id,
    placements: new Map(
      [one, visible].map((tab) => [
        tab.id,
        {
          tabId: tab.id,
          slotId: "slot" as WorkspacePlacement["slotId"],
          rect: { x: 0, y: 0, width: 1, height: 1 },
          focused: tab.id === 1,
        },
      ]),
    ),
    entries: [],
  };
  const admission = createTerminalSurfaceAdmission(() => ({
    ...state,
    entries: surfaces.getSnapshot().entries,
  }));
  const intent = {
    ownerTabKey: one.tabKey,
    projectCwd: one.cwd ?? "",
    slotKey: "dock",
  };
  const register = (tab: TerminalTab, slotKey = "dock", host = one) => {
    tabs.push(tab);
    return surfaces.register({
      tabKey: tab.tabKey,
      ownerTabKey: host.tabKey,
      projectCwd: host.cwd ?? "",
      slotKey,
      focused: true,
      rect: { left: 0, top: 0, width: 0, height: 0 },
    });
  };
  return { one, visible, tabs, surfaces, state, admission, intent, register };
}
it("rejects a new surface before creation when eight assigned leaves already occupy the composite", () => {
  const f = fixture(8);
  expect(f.admission.reserve(f.intent)).toBeUndefined();
  expect(f.admission.size()).toBe(0);
});
it("reserves the final leaf across different slots and retains cancelled reservations until settlement", () => {
  const f = fixture();
  const hold = f.admission.reserve(f.intent);
  assert(hold);
  expect(f.admission.reserve({ ...f.intent, slotKey: "pane" })).toBeUndefined();
  hold.retire();
  expect(hold.isCurrent()).toBe(false);
  expect(f.admission.reserve({ ...f.intent, slotKey: "pane" })).toBeUndefined();
  hold.release();
  hold.release();
  expect(f.admission.reserve({ ...f.intent, slotKey: "pane" })).toBeDefined();
});
it("credits only the surface being replaced, even before the first nonzero geometry measurement", () => {
  const f = fixture();
  f.register(terminal(3));
  expect(
    f.admission.reserve({ ...f.intent, slotKey: "other" }),
  ).toBeUndefined();
  const hold = f.admission.reserve(f.intent);
  assert(hold);
  expect(hold.isCurrent()).toBe(true);
});
it("does not credit a replaced terminal still referenced by another slot or visible as a normal member", () => {
  const f = fixture();
  const old = terminal(3);
  f.register(old);
  f.surfaces.register({
    tabKey: old.tabKey,
    ownerTabKey: f.one.tabKey,
    projectCwd: f.intent.projectCwd,
    slotKey: "other",
    focused: false,
    rect: { left: 0, top: 0, width: 0, height: 0 },
  });
  expect(f.admission.reserve(f.intent)).toBeUndefined();
  const g = fixture(8);
  g.surfaces.register({
    tabKey: g.visible.tabKey,
    ownerTabKey: g.one.tabKey,
    projectCwd: g.intent.projectCwd,
    slotKey: "dock",
    focused: false,
    rect: { left: 0, top: 0, width: 1, height: 1 },
  });
  expect(g.admission.reserve(g.intent)).toBeUndefined();
});
it("revalidates changes to the visible layout and never borrows an unfinished replacement's future savings", () => {
  const f = fixture(4);
  f.register(terminal(3, 4));
  const hold = f.admission.reserve(f.intent);
  assert(hold);
  expect(
    f.admission.reserve({ ...f.intent, slotKey: "other" }),
  ).toBeUndefined();
  f.visible.paneTree = tree(8);
  expect(hold.isCurrent()).toBe(false);
  f.visible.paneTree = tree(4);
  expect(hold.isCurrent()).toBe(false);
  expect(hold.bind(terminal(4).tabKey)).toBe(false);
});
it.each(["", "bad\0slot", "a".repeat(32769)])(
  "rejects malformed slot identities before reservation",
  (slotKey) => {
    const f = fixture();
    expect(f.admission.reserve({ ...f.intent, slotKey })).toBeUndefined();
    expect(f.admission.size()).toBe(0);
  },
);
it("retains a settled successor until a delayed surface takes ownership", () => {
  const f = fixture();
  const hold = f.admission.reserve(f.intent);
  assert(hold);
  const next = terminal(4);
  f.tabs.push(next);
  expect(hold.bind(next.tabKey)).toBe(true);
  hold.release();
  expect(f.admission.size()).toBe(1);
  expect(
    f.admission.reserve({ ...f.intent, slotKey: "other" }),
  ).toBeUndefined();
  f.register(next);
  f.admission.revalidate();
  expect(f.admission.size()).toBe(0);
  expect(
    f.admission.reserve({ ...f.intent, slotKey: "other" }),
  ).toBeUndefined();
  expect(f.admission.reserve(f.intent)).toBeDefined();
});
it("releases a settled latent presentation when its owning view disappears", () => {
  const f = fixture();
  const hold = f.admission.reserve(f.intent);
  assert(hold);
  const next = terminal(4);
  f.tabs.push(next);
  expect(hold.bind(next.tabKey)).toBe(true);
  hold.release();
  f.state.placements = new Map();
  f.admission.revalidate();
  expect(f.admission.size()).toBe(0);
});
it("captures intent identity before the caller can mutate its input", () => {
  const f = fixture(1);
  const input = { ...f.intent };
  const hold = f.admission.reserve(input);
  assert(hold);
  input.slotKey = "changed";
  input.projectCwd = "/srv/other";
  expect(hold.isCurrent()).toBe(true);
  expect(f.admission.reserve(f.intent)).toBeUndefined();
});
it("counts a bound successor once after its canonical slot commits", () => {
  const f = fixture();
  const old = f.register(terminal(3));
  const hold = f.admission.reserve(f.intent);
  assert(hold);
  const next = terminal(4);
  expect(hold.bind(next.tabKey)).toBe(true);
  old.release();
  f.register(next);
  expect(hold.isCurrent()).toBe(true);
  hold.release();
  expect(f.admission.reserve(f.intent)).toBeDefined();
});
it("counts cold ordinary members and rejects hidden or mismatched Harness owners", () => {
  const f = fixture(8);
  f.visible.cold = true;
  expect(f.admission.reserve(f.intent)).toBeUndefined();
  const g = fixture(1);
  expect(
    g.admission.reserve({ ...g.intent, projectCwd: "/srv/other" }),
  ).toBeUndefined();
  g.state.placements = new Map();
  expect(g.admission.reserve(g.intent)).toBeUndefined();
});
it("keeps retired holds across a provider replay without reviving their authority", () => {
  const f = fixture();
  const hold = f.admission.reserve(f.intent);
  assert(hold);
  f.admission.retire();
  f.admission.resume();
  expect(hold.isCurrent()).toBe(false);
  expect(f.admission.reserve(f.intent)).toBeUndefined();
  hold.release();
  expect(f.admission.reserve(f.intent)).toBeDefined();
});
