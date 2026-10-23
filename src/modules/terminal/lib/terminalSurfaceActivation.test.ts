import { expect, it } from "vitest";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs";
import { createTerminalSurfaces } from "@/modules/terminal/lib/terminalSurfaceLayout";
import {
  createTerminalSurfaceAdmission,
  type TerminalAdmissionState,
} from "@/modules/terminal/lib/terminalSurfaceAdmission";

function terminal(id: number, count = 1, cold = true): TerminalTab {
  const leaves = Array.from({ length: count }, (_, index) => ({
    kind: "leaf" as const,
    id: id * 100 + index,
  }));
  return {
    id,
    ...createTabIdentity("main", () => `shell-${id}`),
    kind: "terminal",
    spaceId: "main",
    title: "shell",
    cold,
    projectCwd: "/srv/app",
    activeLeafId: leaves[0].id,
    paneTree:
      leaves.length === 1
        ? leaves[0]
        : {
            kind: "split",
            id: id * 1000,
            dir: "row",
            children: leaves,
          },
  };
}
function fixture() {
  const owner: Tab = {
    id: 1,
    ...createTabIdentity("main", () => "owner"),
    kind: "harness",
    spaceId: "main",
    title: "Harness",
    cwd: "/srv/app",
  };
  const tabs: Tab[] = [owner];
  const surfaces = createTerminalSurfaces();
  const state: TerminalAdmissionState = { tabs, activeId: 1, entries: [] };
  const admission = createTerminalSurfaceAdmission(() => ({
    ...state,
    entries: surfaces.getSnapshot().entries,
  }));
  const register = (tab: TerminalTab, slotKey = `slot-${tab.id}`) => {
    if (!tabs.includes(tab)) tabs.push(tab);
    return surfaces.register({
      tabKey: tab.tabKey,
      ownerTabKey: owner.tabKey,
      projectCwd: "/srv/app",
      focused: false,
      rect: null,
      slotKey,
    });
  };
  return { owner, tabs, surfaces, state, admission, register };
}
it("activates existing cold references without needing geometry or changing tabs", () => {
  const f = fixture();
  const cold = terminal(2, 3);
  f.register(cold);
  expect(
    f.admission.activationTargets().map(({ terminal }) => terminal),
  ).toEqual([cold]);
  expect(cold.cold).toBe(true);
  expect(f.state.activeId).toBe(1);
});
it("deduplicates references and preserves capacity for warm references before cold ones", () => {
  const f = fixture();
  const cold = terminal(2, 2);
  f.register(cold);
  f.register(cold, "duplicate");
  f.register(terminal(3, 7, false));
  expect(f.admission.activationTargets()).toEqual([]);
});
it("admits only complete trees that fit beside ordinary cold composite members", () => {
  const f = fixture();
  const ordinary = terminal(9, 6);
  f.tabs.push(ordinary);
  f.state.placements = new Map(
    [1, 9].map((tabId) => [
      tabId,
      {
        tabId,
        slotId: "slot" as import("@/modules/spaces").SlotId,
        rect: { x: 0, y: 0, width: 1, height: 1 },
        focused: tabId === 1,
      },
    ]),
  );
  f.register(terminal(2, 3));
  const fitting = terminal(3, 2);
  f.register(fitting);
  expect(
    f.admission.activationTargets().map(({ terminal }) => terminal),
  ).toEqual([fitting]);
});
it("retains pending and retired creation capacity until actual settlement", () => {
  const f = fixture();
  const hold = f.admission.reserve({
    ownerTabKey: f.owner.tabKey,
    projectCwd: "/srv/app",
    slotKey: "new",
  });
  expect(hold).toBeDefined();
  const cold = terminal(2, 8);
  f.register(cold);
  hold?.retire();
  expect(f.admission.activationTargets()).toEqual([]);
  hold?.release();
  expect(
    f.admission.activationTargets().map(({ terminal }) => terminal),
  ).toEqual([cold]);
});
it.each([
  "hidden",
  "cold owner",
  "wrong project",
  "private",
  "guest",
  "released",
  "retired",
])("rejects %s activation", (reason) => {
  const f = fixture();
  const cold = terminal(2);
  const receipt = f.register(cold);
  if (reason === "hidden") f.state.activeId = 99;
  if (reason === "cold owner") f.owner.cold = true;
  if (reason === "wrong project") cold.projectCwd = "/other";
  if (reason === "private") cold.private = true;
  if (reason === "guest") cold.collaboration = { mode: "guest" };
  if (reason === "released") receipt.release();
  if (reason === "retired") f.admission.retire();
  expect(f.admission.activationTargets()).toEqual([]);
});
