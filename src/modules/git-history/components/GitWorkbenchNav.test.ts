import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./GitWorkbenchNav";
import type { GitWorkbenchSection } from "../types";

describe("GitWorkbenchNav", () => {
  it("defines all six core workbench navigation items in expected order", () => {
    const expectedSections: GitWorkbenchSection[] = [
      "history",
      "branches",
      "worktrees",
      "tags-stashes",
      "remotes",
      "compare",
    ];

    expect(NAV_ITEMS.map((item) => item.id)).toEqual(expectedSections);
  });

  it("each nav item has a valid labelKey in gitHistory.workbench.sections", () => {
    for (const item of NAV_ITEMS) {
      expect(item.labelKey).toMatch(/^gitHistory\.workbench\.sections\./);
      expect(item.icon).toBeDefined();
    }
  });
});
