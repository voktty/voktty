import { describe, expect, it } from "vitest";
import type { SourceControlFileEntry } from "../useSourceControlPanel";
import { flattenSourceControlTree } from "./tree";

function entry(path: string): SourceControlFileEntry {
  return {
    key: path,
    path,
    originalPath: null,
    statusCode: "M",
    statusLabel: "Modified",
    checkState: "unchecked",
    staged: false,
    unstaged: true,
    untracked: false,
  };
}

describe("flattenSourceControlTree", () => {
  it("renders nested folders before their files with stable depth", () => {
    const rows = flattenSourceControlTree(
      [entry("src/app.ts"), entry("src/components/Button.tsx"), entry("README.md")],
      new Set(),
    );

    expect(rows.map((row) => [row.kind, row.key, row.depth])).toEqual([
      ["folder", "folder:src", 0],
      ["folder", "folder:src/components", 1],
      ["entry", "src/components/Button.tsx", 2],
      ["entry", "src/app.ts", 1],
      ["entry", "README.md", 0],
    ]);
  });

  it("hides descendants of collapsed folders", () => {
    const rows = flattenSourceControlTree(
      [entry("src/app.ts"), entry("src/components/Button.tsx"), entry("README.md")],
      new Set(["src"]),
    );

    expect(rows.map((row) => row.key)).toEqual([
      "folder:src",
      "README.md",
    ]);
  });
});
