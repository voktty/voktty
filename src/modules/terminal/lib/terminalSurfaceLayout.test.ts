import { expect, it, vi } from "vitest";
import {
  createTerminalSurfaces,
  selectTerminalSurfacePlacements,
  type TerminalSurfaceRequest,
} from "@/modules/terminal/lib/terminalSurfaceLayout";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab, HarnessTab } from "@/modules/tabs";
import { asSlotId } from "@/modules/spaces/lib/spaceLayout";

const root = { left: 100, top: 50, width: 800, height: 600 };
const rect = { left: 100, top: 350, width: 400, height: 200 };
function terminal(id = 2, count = 1): TerminalTab {
  const leaves = Array.from({ length: count }, (_, index) => ({
    kind: "leaf" as const,
    id: id * 100 + index,
  }));
  return {
    id,
    ...createTabIdentity("main", () => `terminal-${id}`),
    spaceId: "main",
    kind: "terminal",
    title: "shell",
    projectCwd: "/srv/app",
    activeLeafId: leaves[0].id,
    paneTree:
      leaves.length === 1
        ? leaves[0]
        : { kind: "split", id: id * 1000, dir: "row", children: leaves },
  };
}
function owner(id = 1): HarnessTab {
  return {
    id,
    ...createTabIdentity("main", () => `owner-${id}`),
    spaceId: "main",
    kind: "harness",
    title: "Harness",
    cwd: "/srv/app",
  };
}
function request(): TerminalSurfaceRequest {
  return {
    tabKey: terminal().tabKey,
    ownerTabKey: owner().tabKey,
    projectCwd: "/srv/app",
    rect: { ...rect },
    focused: true,
  };
}
function setup() {
  const store = createTerminalSurfaces();
  store.setRoot(root);
  return store;
}
function select(
  store: ReturnType<typeof setup>,
  tabs: Tab[] = [owner(), terminal()],
  activeId = 1,
) {
  return selectTerminalSurfacePlacements(
    tabs,
    activeId,
    undefined,
    store.getSnapshot(),
  );
}

it("projects viewport geometry into the original terminal stack without changing tabs", () => {
  const store = setup();
  const input = request();
  store.register(input);
  if (!input.rect) throw new Error("Missing rect.");
  input.rect.width = 1;
  expect(select(store).get(terminal().tabKey)).toMatchObject({
    rect: { x: 0, y: 0.5, width: 0.5, height: 1 / 3 },
    focused: true,
  });
});

it("keeps exact receipts and ignores retired snapshots and callbacks", () => {
  const store = setup();
  const focus = vi.fn();
  const old = store.register({ ...request(), onFocus: focus });
  const stale = store.getSnapshot();
  const placement = select(store).get(terminal().tabKey);
  old.release();
  const next = store.register(request());
  expect(old.update({ ...request(), projectCwd: "/other" })).toBe(false);
  placement?.focus();
  expect(focus).not.toHaveBeenCalled();
  expect(
    selectTerminalSurfacePlacements([owner(), terminal()], 1, undefined, stale)
      .size,
  ).toBe(0);
  expect(next.isCurrent()).toBe(true);
  old.release();
  expect(select(store).size).toBe(1);
});

it("retains one presentation for duplicate references and admits the next after release", () => {
  const store = setup();
  const firstFocus = vi.fn();
  const secondFocus = vi.fn();
  const first = store.register({ ...request(), onFocus: firstFocus });
  store.register({ ...request(), onFocus: secondFocus });
  expect(select(store).size).toBe(1);
  select(store).get(terminal().tabKey)?.focus();
  expect(firstFocus).toHaveBeenCalledOnce();
  expect(secondFocus).not.toHaveBeenCalled();
  first.release();
  select(store).get(terminal().tabKey)?.focus();
  expect(secondFocus).toHaveBeenCalledOnce();
});

it("invalidates captured geometry and focus callbacks when a registration updates", () => {
  const store = setup();
  const oldFocus = vi.fn();
  const nextFocus = vi.fn();
  const receipt = store.register({ ...request(), onFocus: oldFocus });
  const snapshot = store.getSnapshot();
  const oldPlacement = select(store).get(terminal().tabKey);
  receipt.update({ ...request(), onFocus: nextFocus });
  oldPlacement?.focus();
  expect(oldFocus).not.toHaveBeenCalled();
  expect(
    selectTerminalSurfacePlacements(
      [owner(), terminal()],
      1,
      undefined,
      snapshot,
    ).size,
  ).toBe(0);
  select(store).get(terminal().tabKey)?.focus();
  expect(nextFocus).toHaveBeenCalledOnce();
  expect(receipt.isCurrent()).toBe(true);
});

it.each([
  "missing owner",
  "hidden owner",
  "missing terminal",
  "cold terminal",
  "cold owner",
  "different project",
  "different owner project",
  "private",
  "guest",
])("refuses %s without admitting a terminal placement", (scenario) => {
  const store = setup();
  store.register(request());
  const host = owner();
  const source = terminal();
  if (scenario === "cold terminal") source.cold = true;
  if (scenario === "cold owner") host.cold = true;
  if (scenario === "different project") source.projectCwd = "/other";
  if (scenario === "different owner project") host.cwd = "/other";
  if (scenario === "private") source.private = true;
  if (scenario === "guest") source.collaboration = { mode: "guest" };
  const tabs: Tab[] =
    scenario === "missing owner"
      ? [source]
      : scenario === "missing terminal"
        ? [host]
        : [host, source];
  expect(select(store, tabs, scenario === "hidden owner" ? 99 : 1).size).toBe(
    0,
  );
});

it("gives an ordinary visible terminal precedence over a dock reference", () => {
  const store = setup();
  store.register(request());
  const placements = new Map([
    [
      1,
      {
        tabId: 1,
        slotId: asSlotId("owner"),
        rect: { x: 0, y: 0, width: 0.5, height: 1 },
        focused: false,
      },
    ],
    [
      2,
      {
        tabId: 2,
        slotId: asSlotId("terminal"),
        rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
        focused: true,
      },
    ],
  ]);
  expect(
    selectTerminalSurfacePlacements(
      [owner(), terminal()],
      2,
      placements,
      store.getSnapshot(),
    ).size,
  ).toBe(0);
});

it("clips a surface to its owning composite member and respects outer focus", () => {
  const store = setup();
  store.register({
    ...request(),
    rect: { left: -100, top: 0, width: 2000, height: 2000 },
  });
  const placements = new Map([
    [
      1,
      {
        tabId: 1,
        slotId: asSlotId("owner"),
        rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
        focused: false,
      },
    ],
  ]);
  expect(
    selectTerminalSurfacePlacements(
      [owner(), terminal()],
      99,
      placements,
      store.getSnapshot(),
    ).get(terminal().tabKey),
  ).toMatchObject({
    rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
    focused: false,
  });
});

it("counts real split leaves across ordinary placements and docks against the shared budget", () => {
  const store = setup();
  const source = terminal(2, 2);
  const ordinary = terminal(3, 7);
  store.register(request());
  const placements = new Map([
    [
      1,
      {
        tabId: 1,
        slotId: asSlotId("owner"),
        rect: { x: 0, y: 0, width: 0.5, height: 1 },
        focused: true,
      },
    ],
    [
      3,
      {
        tabId: 3,
        slotId: asSlotId("ordinary"),
        rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
        focused: false,
      },
    ],
  ]);
  const tabs = [owner(), source, ordinary];
  expect(
    selectTerminalSurfacePlacements(tabs, 1, placements, store.getSnapshot())
      .size,
  ).toBe(0);
  expect(
    selectTerminalSurfacePlacements(
      [owner(), terminal(), ordinary],
      1,
      placements,
      store.getSnapshot(),
    ).size,
  ).toBe(1);
  expect(source.paneTree.kind).toBe("split");
});

it("bounds registrations, validates geometry and keeps unchanged snapshots stable", () => {
  const store = createTerminalSurfaces(1);
  const receipt = store.register(request());
  expect(() => store.register(request())).toThrow("limit");
  const snapshot = store.getSnapshot();
  expect(receipt.update(request())).toBe(true);
  expect(store.getSnapshot()).toBe(snapshot);
  expect(() => store.setRoot({ ...root, width: Number.NaN })).toThrow("bounds");
  expect(() =>
    receipt.update({ ...request(), rect: { ...rect, height: -1 } }),
  ).toThrow("surface");
  receipt.release();
  expect(() => store.register(request())).not.toThrow();
});

it("never presents a surface outside the root or with zero-sized bounds", () => {
  const store = setup();
  const receipt = store.register({
    ...request(),
    rect: { ...rect, left: 2000 },
  });
  expect(select(store).size).toBe(0);
  receipt.update(request());
  store.setRoot({ ...root, width: 0 });
  expect(select(store).size).toBe(0);
});
