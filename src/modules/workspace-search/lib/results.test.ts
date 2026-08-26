import {
  groupWorkspaceSearchHits,
  splitSearchHitText,
} from "@/modules/workspace-search/lib/results";
import type { WorkspaceSearchHit } from "@/modules/workspace-search/types";
import { describe, expect, it } from "vitest";

const hit = (
  rel: string,
  line: number,
  column: number,
  text = "const widget = createWidget();",
): WorkspaceSearchHit => ({
  path: `/project/${rel}`,
  rel,
  line,
  column,
  matchLength: 6,
  previewColumn: column,
  text,
});

describe("workspace search results", () => {
  it("groups by file and orders files and locations deterministically", () => {
    const groups = groupWorkspaceSearchHits([
      hit("src/z.ts", 8, 4),
      hit("src/a.ts", 9, 8),
      hit("src/a.ts", 2, 3),
    ]);

    expect(groups.map((group) => group.rel)).toEqual(["src/a.ts", "src/z.ts"]);
    expect(groups[0]?.hits.map((item) => item.line)).toEqual([2, 9]);
  });

  it("splits the matched range using UTF-16 columns returned by Rust", () => {
    expect(
      splitSearchHitText({
        ...hit("src/a.ts", 1, 4, "a😀widgetz"),
        matchLength: 6,
        previewColumn: 4,
      }),
    ).toEqual({ before: "a😀", match: "widget", after: "z" });
  });

  it("uses the preview column while retaining the absolute editor column", () => {
    expect(
      splitSearchHitText({
        ...hit("src/a.ts", 1, 4001, "😀widgetz"),
        previewColumn: 3,
      }),
    ).toEqual({ before: "😀", match: "widget", after: "z" });
  });

  it("keeps the match visible when a minified line has long context", () => {
    const prefix = "a".repeat(200);
    const suffix = "z".repeat(300);
    const parts = splitSearchHitText({
      ...hit("src/a.ts", 1, 201, `${prefix}widget${suffix}`),
      previewColumn: 201,
    });

    expect(parts.before).toBe(`...${"a".repeat(28)}`);
    expect(parts.match).toBe("widget");
    expect(parts.after).toBe(`${"z".repeat(160)}...`);
  });
});
