import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_TERMINAL_LEAVES,
  projectPaneBudget,
  tabAssignmentPaneBudget,
  terminalLeafCount,
  visibleTerminalLeafCount,
  viewSpacePaneBudget,
} from "./spacePaneBudget";

function terminal(tabKey: string, leafCount = 1) {
  let nextId = 1;
  const leaves = Array.from({ length: leafCount }, () => ({
    kind: "leaf" as const,
    id: nextId++,
  }));
  const paneTree =
    leaves.length === 1
      ? leaves[0]
      : {
          kind: "split" as const,
          id: nextId++,
          dir: "row" as const,
          children: leaves,
        };
  return { tabKey: asTabKey(tabKey), kind: "terminal", paneTree };
}

describe("spacePaneBudget", () => {
  it("counts terminal leaves from nested pane trees only once per member", () => {
    const tabs = [terminal("one", 2), terminal("two", 3)];
    expect(
      visibleTerminalLeafCount(tabs, [asTabKey("one"), asTabKey("one")]),
    ).toBe(2);
    expect(
      visibleTerminalLeafCount(tabs, [asTabKey("one"), asTabKey("two")]),
    ).toBe(5);
    expect(terminalLeafCount(tabs[1])).toBe(3);
  });

  it("keeps a renderer slot as operational margin", () => {
    expect(MAX_VISIBLE_TERMINAL_LEAVES).toBe(8);
    expect(projectPaneBudget(7, 1).allowed).toBe(true);
    expect(projectPaneBudget(8, 1)).toMatchObject({
      projected: 9,
      allowed: false,
    });
  });

  it("does not charge a tab already mounted in the target space", () => {
    const tabs = [terminal("one", 4), terminal("two", 4)];
    const budget = tabAssignmentPaneBudget(
      tabs,
      [asTabKey("one"), asTabKey("two")],
      asTabKey("one"),
    );
    expect(budget).toMatchObject({ current: 8, added: 0, allowed: true });
  });

  it("rejects a new member when its internal panes exceed the budget", () => {
    const tabs = [terminal("one", 7), terminal("two", 2)];
    const budget = tabAssignmentPaneBudget(
      tabs,
      [asTabKey("one")],
      asTabKey("two"),
    );
    expect(budget).toMatchObject({
      current: 7,
      added: 2,
      projected: 9,
      allowed: false,
    });
    expect(viewSpacePaneBudget(tabs, [asTabKey("one")]).allowed).toBe(true);
  });
});
