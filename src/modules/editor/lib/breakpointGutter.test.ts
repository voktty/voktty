import { describe, expect, it } from "vitest";
import { breakpointLinesForPath } from "./breakpointGutter";

describe("breakpointLinesForPath", () => {
  it("selects, deduplicates and bounds lines for one file", () => {
    expect(
      breakpointLinesForPath(
        [
          { path: "C:\\repo\\main.ts", line: 5 },
          { path: "c:/repo/main.ts", line: 5 },
          { path: "C:/repo/main.ts", line: 9 },
          { path: "C:/repo/other.ts", line: 3 },
        ],
        "C:/repo/main.ts",
        7,
      ),
    ).toEqual([5]);
  });

  it("preserves case sensitivity for Unix paths", () => {
    expect(
      breakpointLinesForPath(
        [
          { path: "/repo/Main.ts", line: 2 },
          { path: "/repo/main.ts", line: 3 },
        ],
        "/repo/Main.ts",
        10,
      ),
    ).toEqual([2]);
  });
});
