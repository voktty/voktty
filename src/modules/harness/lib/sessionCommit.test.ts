import { describe, expect, it, vi } from "vitest";
import type { CheckpointFile } from "./checkpoint";
import { resolveSessionCommitRepositories } from "./sessionCommit";

function file(path: string, exact = true): CheckpointFile {
  return {
    path,
    relative: path,
    status: "modified",
    additions: 1,
    deletions: 0,
    exact,
    undoable: true,
  };
}

describe("resolveSessionCommitRepositories", () => {
  it("groups exact files by nested repository and excludes shared or outside files", async () => {
    const resolveRepo = vi.fn(async (directory: string) => {
      if (directory.startsWith("/repo/packages/tool/")) {
        return {
          repoRoot: "/repo/packages/tool",
          branch: "main",
          upstream: null,
          isDetached: false,
        };
      }
      return {
        repoRoot: "/repo",
        branch: "main",
        upstream: null,
        isDetached: false,
      };
    });
    const files = [
      file("/repo/src/a.ts"),
      file("/repo/src/b.ts"),
      file("/repo/packages/tool/src/main.rs"),
      file("/outside/file.ts"),
      file("/repo/shared.ts", false),
    ];

    const result = await resolveSessionCommitRepositories(files, resolveRepo);

    expect(resolveRepo).toHaveBeenCalledTimes(3);
    expect(result.repositories).toEqual([
      {
        repoRoot: "/repo",
        files: [files[0], files[1]],
      },
      {
        repoRoot: "/repo/packages/tool",
        files: [files[2]],
      },
    ]);
    expect(result.unresolvedFiles).toEqual([files[3]]);
    expect(resolveRepo).not.toHaveBeenCalledWith("/repo/shared.ts");
  });
});
