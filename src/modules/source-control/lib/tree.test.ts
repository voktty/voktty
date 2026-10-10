import { describe, expect, it } from "vitest";
import type { SourceControlFileEntry } from "../useSourceControlPanel";
import { flattenSourceControlTree, sourceControlFolderPaths } from "./tree";

function entry(
  path: string,
  state: { staged?: boolean; unstaged?: boolean } = {},
): SourceControlFileEntry {
  const staged = state.staged ?? false;
  const unstaged = state.unstaged ?? true;
  return {
    key: path,
    path,
    originalPath: null,
    statusCode: "M",
    statusLabel: "Modified",
    checkState:
      staged && unstaged ? "indeterminate" : staged ? "checked" : "unchecked",
    staged,
    unstaged,
    untracked: false,
  };
}

describe("flattenSourceControlTree", () => {
  it("renders nested folders before their files with stable depth", () => {
    const rows = flattenSourceControlTree(
      [
        entry("src/app.ts"),
        entry("src/components/Button.tsx"),
        entry("README.md"),
      ],
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
      [
        entry("src/app.ts"),
        entry("src/components/Button.tsx"),
        entry("README.md"),
      ],
      new Set(["src"]),
    );

    expect(rows.map((row) => row.key)).toEqual(["folder:src", "README.md"]);
  });

  it.each([
    {
      entries: [entry("src/a.ts", { staged: true, unstaged: false })],
      state: "checked",
    },
    {
      entries: [
        entry("src/a.ts", { staged: true, unstaged: false }),
        entry("src/b.ts"),
      ],
      state: "indeterminate",
    },
    { entries: [entry("src/a.ts")], state: "unchecked" },
  ] as const)(
    "derives folder staging state as $state",
    ({ entries, state }) => {
      const folder = flattenSourceControlTree(entries, new Set()).find(
        (row) => row.kind === "folder" && row.path === "src",
      );
      expect(folder?.kind === "folder" ? folder.checkState : undefined).toBe(
        state,
      );
    },
  );

  it("selects only actionable files inside the exact folder subtree", () => {
    const entries = [
      entry("src/app.ts"),
      entry("src/components/Button.tsx", { staged: true, unstaged: false }),
      entry("src/components/Next.tsx", { staged: true }),
      entry("src-old/app.ts"),
      entry("README.md"),
    ];

    expect(sourceControlFolderPaths(entries, "src", "stage")).toEqual([
      "src/app.ts",
      "src/components/Next.tsx",
    ]);
    expect(
      sourceControlFolderPaths(entries, "src\\components", "unstage"),
    ).toEqual(["src/components/Button.tsx", "src/components/Next.tsx"]);
    expect(sourceControlFolderPaths(entries, "../src", "stage")).toEqual([]);
  });
});
