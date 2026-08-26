import { describe, expect, it } from "vitest";
import { workspaceReplaceSpec, workspaceReplaceTargets } from "./replace";

describe("workspace replacement planning", () => {
  it("keeps search semantics in the replacement spec", () => {
    expect(
      workspaceReplaceSpec(
        {
          query: "foo",
          regex: true,
          caseSensitive: false,
          wholeWord: true,
          include: "src/**",
          exclude: "dist/**",
        },
        "$1",
      ),
    ).toEqual({
      pattern: "foo",
      replacement: "$1",
      regex: true,
      caseSensitive: false,
      wholeWord: true,
    });
  });

  it("creates commit targets only for selected preview files", () => {
    const files = ["a.ts", "b.ts"].map((path, index) => ({
      path,
      mtime: index + 1,
      hash: `hash-${index}`,
      replacements: index + 2,
      occurrences: [],
      previewTruncated: false,
    }));

    expect(workspaceReplaceTargets(files, new Set(["b.ts"]))).toEqual([
      {
        path: "b.ts",
        expectedMtime: 2,
        expectedHash: "hash-1",
        expectedReplacements: 3,
      },
    ]);
  });
});
