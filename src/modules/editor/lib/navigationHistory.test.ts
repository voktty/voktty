import { describe, expect, it } from "vitest";
import {
  createNavigationHistory,
  hydrateNavigationHistory,
  navigateHistory,
  recordNavigation,
  type EditorNavigationLocation,
} from "./navigationHistory";

function location(path: string, line: number): EditorNavigationLocation {
  return { spaceId: "default", path, line, column: 1 };
}

describe("editor navigation history", () => {
  it("records an origin and destination, then moves backward and forward", () => {
    const state = recordNavigation(
      createNavigationHistory(),
      location("src/a.ts", 4),
      location("src/b.ts", 12),
    );

    const back = navigateHistory(state, "back");
    expect(back.target).toEqual(location("src/a.ts", 4));
    expect(navigateHistory(back.state, "forward").target).toEqual(
      location("src/b.ts", 12),
    );
  });

  it("drops the forward branch after a new navigation", () => {
    const initial = recordNavigation(
      createNavigationHistory(),
      location("a.ts", 1),
      location("b.ts", 2),
    );
    const back = navigateHistory(initial, "back");
    const branched = recordNavigation(
      back.state,
      location("a.ts", 1),
      location("c.ts", 3),
    );

    expect(branched.entries.map((entry) => entry.path)).toEqual([
      "a.ts",
      "c.ts",
    ]);
    expect(navigateHistory(branched, "forward").target).toBeNull();
  });

  it("normalizes paths and ignores consecutive duplicate locations", () => {
    const state = recordNavigation(
      createNavigationHistory(),
      location("src\\a.ts", 0),
      location("src/a.ts", 1),
    );

    expect(state.entries).toEqual([location("src/a.ts", 1)]);
    expect(state.canGoBack).toBe(false);
  });

  it("keeps a bounded history", () => {
    let state = createNavigationHistory(3);
    for (let line = 1; line <= 5; line += 1) {
      state = recordNavigation(
        state,
        location("a.ts", line),
        location("a.ts", line + 1),
      );
    }

    expect(state.entries).toHaveLength(3);
    expect(state.entries.map((entry) => entry.line)).toEqual([4, 5, 6]);
  });

  it("hydrates only valid bounded locations", () => {
    const state = hydrateNavigationHistory(
      {
        entries: [
          location("src\\a.ts", 4),
          { spaceId: "", path: "", line: -1, column: 0 },
          null,
          location("src/b.ts", 8),
        ],
        index: 99,
      },
      2,
    );

    expect(state.entries).toEqual([
      location("src/a.ts", 4),
      location("src/b.ts", 8),
    ]);
    expect(state.index).toBe(1);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(false);
  });
});
