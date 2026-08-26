import { describe, expect, it } from "vitest";
import {
  pushClosedEditor,
  takeClosedEditor,
  type ClosedEditor,
} from "./recentlyClosedEditors";

const editor = (path: string): ClosedEditor => ({
  path,
  spaceId: "space-1",
  overrideLanguage: null,
});

describe("recentlyClosedEditors", () => {
  it("restores editors in last-closed-first order", () => {
    let stack = pushClosedEditor([], editor("/a.ts"));
    stack = pushClosedEditor(stack, editor("/b.ts"));

    const first = takeClosedEditor(stack);
    expect(first.editor?.path).toBe("/b.ts");
    expect(first.stack.map((entry) => entry.path)).toEqual(["/a.ts"]);
  });

  it("deduplicates paths and enforces a bounded history", () => {
    let stack: ClosedEditor[] = [];
    for (let index = 0; index < 30; index += 1) {
      stack = pushClosedEditor(stack, editor(`/file-${index}.ts`), 20);
    }
    stack = pushClosedEditor(stack, editor("/file-15.ts"), 20);

    expect(stack).toHaveLength(20);
    expect(stack[stack.length - 1]?.path).toBe("/file-15.ts");
    expect(stack.filter((entry) => entry.path === "/file-15.ts")).toHaveLength(1);
  });

  it("keeps identical paths from different filesystems", () => {
    const ubuntu = {
      ...editor("/home/serge/app.ts"),
      workspaceEnv: { kind: "wsl" as const, distro: "Ubuntu" },
    };
    const debian = {
      ...editor("/home/serge/app.ts"),
      workspaceEnv: { kind: "wsl" as const, distro: "Debian" },
    };

    const stack = pushClosedEditor(pushClosedEditor([], ubuntu), debian);

    expect(stack).toHaveLength(2);
  });
});
