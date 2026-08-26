import { describe, expect, it } from "vitest";
import {
  quickOpenScope,
  rankQuickOpenFiles,
  resolveQuickOpenPath,
  workspaceRelativePath,
} from "./quickOpen";

describe("Quick Open file ranking", () => {
  const files = [
    "src/modules/editor/EditorPane.tsx",
    "src/modules/tabs/TabBar.tsx",
    "docs/editor.md",
    "README.md",
  ];

  it("shows recent files first when the query is empty", () => {
    expect(
      rankQuickOpenFiles(files, "", ["docs/editor.md", "README.md"]).map(
        (match) => match.rel,
      ),
    ).toEqual([
      "docs/editor.md",
      "README.md",
      "src/modules/editor/EditorPane.tsx",
      "src/modules/tabs/TabBar.tsx",
    ]);
  });

  it("favours filename matches over incidental directory matches", () => {
    expect(rankQuickOpenFiles(files, "editor", [])[0]?.rel).toBe(
      "docs/editor.md",
    );
  });

  it("deduplicates canonical paths and respects the result limit", () => {
    expect(
      rankQuickOpenFiles(
        ["src\\main.ts", "src/main.ts", "src/app.ts"],
        "",
        [],
        1,
      ),
    ).toHaveLength(1);
  });
});

describe("Quick Open workspace paths", () => {
  it("joins Windows and Unix roots using the frontend canonical form", () => {
    expect(resolveQuickOpenPath("C:\\project", "src\\main.ts")).toBe(
      "C:/project/src/main.ts",
    );
    expect(resolveQuickOpenPath("/srv/project/", "src/main.rs")).toBe(
      "/srv/project/src/main.rs",
    );
    expect(resolveQuickOpenPath("/", "etc/hosts")).toBe("/etc/hosts");
  });

  it("only derives relative paths inside the selected workspace", () => {
    expect(
      workspaceRelativePath("C:/project", "C:\\project\\src\\main.ts"),
    ).toBe("src/main.ts");
    expect(
      workspaceRelativePath("C:/Project", "c:\\project\\src\\main.ts"),
    ).toBe("src/main.ts");
    expect(
      workspaceRelativePath("/srv/project", "/srv/other/main.rs"),
    ).toBeNull();
  });

  it("scopes recency by environment and root", () => {
    expect(quickOpenScope("/srv/project/", "ssh:server")).toBe(
      "ssh:server:/srv/project",
    );
  });
});
