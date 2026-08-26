import { describe, expect, it } from "vitest";
import {
  NO_ACTIVE_TAB_ID,
  planSingleTabClose,
  type Tab,
  type TerminalTab,
} from "./useTabs";

function terminal(
  id: number,
  spaceId: string,
  leafIds: number[] = [id * 10],
): TerminalTab {
  const [first, second] = leafIds;
  return {
    id,
    kind: "terminal",
    spaceId,
    title: `terminal-${id}`,
    paneTree:
      second === undefined
        ? { kind: "leaf", id: first }
        : {
            kind: "split",
            id: id * 100,
            dir: "row",
            children: [
              { kind: "leaf", id: first },
              { kind: "leaf", id: second },
            ],
          },
    activeLeafId: first,
  } as TerminalTab;
}

describe("planSingleTabClose", () => {
  it("releases only the terminal leaves owned by the closing tab", () => {
    const tabs: Tab[] = [terminal(1, "a", [10, 11]), terminal(2, "b", [20])];
    const result = planSingleTabClose(tabs, 1, 1, 2);

    expect(result?.tabs.map((tab) => tab.id)).toEqual([2]);
    expect(result?.disposeLeafIds).toEqual([10, 11]);
    expect(result?.nextActiveId).toBe(2);
  });

  it("does not move focus when a background tab closes", () => {
    const tabs: Tab[] = [terminal(1, "a"), terminal(2, "b")];
    expect(planSingleTabClose(tabs, 2, 1)?.nextActiveId).toBe(1);
  });

  it("uses an explicit cross-space fallback for the last active tab", () => {
    const tabs: Tab[] = [terminal(1, "local"), terminal(2, "ssh")];
    expect(planSingleTabClose(tabs, 2, 2, 1)?.nextActiveId).toBe(1);
  });

  it("uses the empty sentinel only when no resource survives", () => {
    expect(
      planSingleTabClose([terminal(1, "default")], 1, 1, null)
        ?.nextActiveId,
    ).toBe(NO_ACTIVE_TAB_ID);
  });

  it("refuses to remove a locked tab", () => {
    const locked = { ...terminal(1, "default"), locked: true };
    expect(planSingleTabClose([locked], 1, 1)).toBeNull();
  });
});
