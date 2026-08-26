import { describe, expect, it } from "vitest";
import { pathAncestorsWithinRoot } from "./useFileTree";

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
