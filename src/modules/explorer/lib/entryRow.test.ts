import { describe, expect, it } from "vitest";
import { entryRowAt } from "./entryRow";

type Row =
  | { kind: "entry"; path: string; isDir: boolean }
  | { kind: "rename"; path: string };

const rows: Row[] = [
  { kind: "entry", path: "/repo/a.ts", isDir: false },
  { kind: "rename", path: "/repo/b.ts" },
  { kind: "entry", path: "/repo/src", isDir: true },
];

const index = new Map<string, number>([
  ["/repo/a.ts", 0],
  ["/repo/b.ts", 1],
  ["/repo/src", 2],
]);

describe("entryRowAt", () => {
  it("returns the entry row behind a path", () => {
    expect(entryRowAt(rows, index, "/repo/src")).toEqual({
      kind: "entry",
      path: "/repo/src",
      isDir: true,
    });
  });

  it("returns null for a row that is not an entry", () => {
    expect(entryRowAt(rows, index, "/repo/b.ts")).toBeNull();
  });

  it("returns null for a path the index does not know", () => {
    expect(entryRowAt(rows, index, "/repo/gone.ts")).toBeNull();
  });

  it("returns null instead of indexing past the end", () => {
    // A handler can hold an index from an earlier render while the rows have
    // already shrunk, which is what a keystroke arriving during a delete does.
    const stale = new Map<string, number>([["/repo/a.ts", 9]]);
    expect(entryRowAt(rows, stale, "/repo/a.ts")).toBeNull();
  });

  it("returns null when there is no path to look up", () => {
    expect(entryRowAt(rows, index, undefined)).toBeNull();
  });

  it("returns null on an empty row list", () => {
    expect(entryRowAt([], index, "/repo/a.ts")).toBeNull();
  });
});
