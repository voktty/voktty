import { describe, expect, it } from "vitest";
import { selectDirtyDirectories } from "./dirtyDirectories";

describe("selectDirtyDirectories", () => {
  it("returns nothing when either side is empty", () => {
    expect(selectDirtyDirectories([], ["/a"])).toEqual([]);
    expect(selectDirtyDirectories(["/a/b.txt"], [])).toEqual([]);
  });

  it("selects the directory holding a changed file", () => {
    expect(
      selectDirtyDirectories(["/repo/src/main.ts"], ["/repo", "/repo/src"]),
    ).toEqual(["/repo/src"]);
  });

  it("selects a changed directory whose own listing is open", () => {
    expect(
      selectDirtyDirectories(["/repo/src"], ["/repo", "/repo/src"]),
    ).toEqual(expect.arrayContaining(["/repo", "/repo/src"]));
  });

  it("ignores changes under directories that are not loaded", () => {
    expect(
      selectDirtyDirectories(["/repo/dist/out.js"], ["/repo/src"]),
    ).toEqual([]);
  });

  it("matches across separator and trailing-slash spellings", () => {
    // The key is returned exactly as the tree holds it, because that is what
    // the relist is keyed by; only the comparison is normalized.
    expect(
      selectDirtyDirectories(["C:\\repo\\src\\main.ts"], ["C:/repo/src/"]),
    ).toEqual(["C:/repo/src/"]);
  });

  it("is case insensitive, as Windows drive letters vary", () => {
    expect(
      selectDirtyDirectories(["c:/Repo/Src/main.ts"], ["C:/repo/src"]),
    ).toEqual(["C:/repo/src"]);
  });

  it("relists every spelling of a directory that appears more than once", () => {
    const dirty = selectDirtyDirectories(
      ["C:/repo/src/main.ts"],
      ["C:/repo/src", "c:/REPO/src"],
    );
    expect(dirty.sort()).toEqual(["C:/repo/src", "c:/REPO/src"]);
  });

  it("deduplicates a directory hit by many paths in one batch", () => {
    const paths = Array.from({ length: 500 }, (_, i) => `/repo/src/f${i}.ts`);
    expect(selectDirtyDirectories(paths, ["/repo/src"])).toEqual(["/repo/src"]);
  });

  it("handles a large batch against many directories", () => {
    const dirs = Array.from({ length: 200 }, (_, i) => `/repo/d${i}`);
    const paths = Array.from({ length: 2000 }, (_, i) => `/repo/d${i % 200}/f`);
    expect(selectDirtyDirectories(paths, dirs).sort()).toEqual(
      [...dirs].sort(),
    );
  });
});
