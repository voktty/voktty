import { describe, expect, it } from "vitest";
import {
  dirtyWorkspaceTextEditPaths,
  workspaceTextEditTargets,
} from "./service";

describe("workspace text edit targets", () => {
  it("binds selected previews to their exact structural edits", () => {
    const edits = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 3 },
        },
        newText: "next",
      },
    ];
    expect(
      workspaceTextEditTargets(
        [
          {
            path: "a.ts",
            mtime: 7,
            hash: "abc",
            resultHash: "abc-next",
            edits: 1,
            occurrences: [],
            previewTruncated: false,
          },
          {
            path: "b.ts",
            mtime: 8,
            hash: "def",
            resultHash: "def-next",
            edits: 1,
            occurrences: [],
            previewTruncated: false,
          },
        ],
        [
          { path: "a.ts", edits },
          { path: "b.ts", edits },
        ],
        new Set(["b.ts"]),
      ),
    ).toEqual([
      {
        path: "b.ts",
        edits,
        expectedMtime: 8,
        expectedHash: "def",
        expectedResultHash: "def-next",
        expectedEdits: 1,
      },
    ]);
  });

  it("does not create a target when preview and request diverge", () => {
    expect(
      workspaceTextEditTargets(
        [
          {
            path: "a.ts",
            mtime: 1,
            hash: "abc",
            resultHash: "abc-next",
            edits: 2,
            occurrences: [],
            previewTruncated: false,
          },
        ],
        [{ path: "a.ts", edits: [] }],
        new Set(["a.ts"]),
      ),
    ).toEqual([]);
  });

  it("finds affected dirty buffers with Windows path semantics", () => {
    expect(
      dirtyWorkspaceTextEditPaths(
        "C:/Repo",
        [{ path: "src/a.ts", edits: [] }],
        ["c:\\repo\\src\\a.ts", "C:/Repo/src/clean.ts"],
      ),
    ).toEqual(["src/a.ts"]);
  });
});
