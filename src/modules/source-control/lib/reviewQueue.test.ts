import type { GitChangedFile } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import {
  absoluteGitReviewPath,
  buildGitReviewEntries,
  isGitReviewEntryDirty,
  reconcileGitReviewPath,
  sameGitReviewRepository,
} from "./reviewQueue";

function changed(
  path: string,
  patch: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    path,
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    statusLabel: "Modified",
    ...patch,
  };
}

describe("Git review queue", () => {
  it("projects one stable row per changed path with staged state", () => {
    const entries = buildGitReviewEntries([
      changed("src/a.ts"),
      changed("src/b.ts", {
        indexStatus: "A",
        worktreeStatus: "M",
        staged: true,
      }),
      changed("src/old.ts", {
        path: "src/new.ts",
        originalPath: "src/old.ts",
        indexStatus: "R",
        worktreeStatus: " ",
        staged: true,
        unstaged: false,
        statusLabel: "Renamed",
      }),
      changed("src/a.ts"),
    ]);

    expect(entries).toEqual([
      expect.objectContaining({
        path: "src/a.ts",
        statusCode: "M",
        checkState: "unchecked",
      }),
      expect.objectContaining({
        path: "src/b.ts",
        statusCode: "M",
        checkState: "indeterminate",
      }),
      expect.objectContaining({
        path: "src/new.ts",
        originalPath: "src/old.ts",
        statusCode: "R",
        checkState: "checked",
      }),
    ]);
  });

  it("guards current and renamed dirty buffers across Windows path forms", () => {
    const entry = {
      path: "src/new.ts",
      originalPath: "src/old.ts",
    };
    expect(
      isGitReviewEntryDirty("C:\\Work\\Repo", entry, [
        "c:/work/repo/src/NEW.ts",
      ]),
    ).toBe(true);
    expect(
      isGitReviewEntryDirty("C:\\Work\\Repo", entry, [
        "C:\\Work\\Repo\\src\\old.ts",
      ]),
    ).toBe(true);
    expect(
      isGitReviewEntryDirty("/work/repo", entry, ["/work/repo/src/NEW.ts"]),
    ).toBe(false);
  });

  it("keeps selection by path and falls forward when a change disappears", () => {
    const entries = [{ path: "a.ts" }, { path: "b.ts" }];
    expect(reconcileGitReviewPath(entries, "b.ts")).toBe("b.ts");
    expect(reconcileGitReviewPath(entries, "gone.ts")).toBe("a.ts");
    expect(reconcileGitReviewPath([], "gone.ts")).toBeNull();
  });

  it("resolves relative repository paths without changing absolute paths", () => {
    expect(absoluteGitReviewPath("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
    expect(absoluteGitReviewPath("/repo", "/other/a.ts")).toBe("/other/a.ts");
    expect(sameGitReviewRepository("C:\\Work\\Repo", "c:/work/repo/")).toBe(
      true,
    );
    expect(sameGitReviewRepository("/Work/Repo", "/work/repo")).toBe(false);
  });
});
