import { describe, expect, it } from "vitest";
import {
  type DirEntry,
  hasDirListingMetadataChanged,
  pathAncestorsWithinRoot,
} from "./useFileTree";

function entry(overrides: Partial<DirEntry> = {}): DirEntry {
  return {
    name: "file.ts",
    kind: "file",
    size: 10,
    mtime: 100,
    gitignored: false,
    ...overrides,
  };
}

describe("pathAncestorsWithinRoot", () => {
  it("returns the directories that must be expanded", () => {
    expect(pathAncestorsWithinRoot("C:/repo", "C:/repo/src/lib/a.ts")).toEqual([
      "C:/repo/src",
      "C:/repo/src/lib",
    ]);
  });

  it("compares Windows and UNC roots case-insensitively", () => {
    expect(pathAncestorsWithinRoot("c:/Repo", "C:/repo/src/a.ts")).toEqual([
      "c:/Repo/src",
    ]);
    expect(
      pathAncestorsWithinRoot("//SERVER/Share", "//server/share/a.ts"),
    ).toEqual([]);
  });

  it("rejects files outside the workspace root", () => {
    expect(pathAncestorsWithinRoot("C:/repo", "C:/other/a.ts")).toBeNull();
  });
});

describe("hasDirListingMetadataChanged", () => {
  it("does not invalidate Git when an SMB poll returns the same listing", () => {
    expect(hasDirListingMetadataChanged([entry()], [entry()])).toBe(false);
  });

  it("detects content metadata and structural changes", () => {
    expect(
      hasDirListingMetadataChanged([entry()], [entry({ mtime: 101 })]),
    ).toBe(true);
    expect(hasDirListingMetadataChanged([entry()], [entry({ size: 11 })])).toBe(
      true,
    );
    expect(
      hasDirListingMetadataChanged([entry()], [entry({ name: "new.ts" })]),
    ).toBe(true);
  });

  it("accepts an updated metadata baseline after reporting a change", () => {
    const changed = [entry({ mtime: 101 })];
    expect(hasDirListingMetadataChanged([entry()], changed)).toBe(true);
    expect(hasDirListingMetadataChanged(changed, [entry({ mtime: 101 })])).toBe(
      false,
    );
  });
});
