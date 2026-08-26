import type { Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { describe, expect, it } from "vitest";
import { collectEditorWatchGroups } from "./useEditorFileSync";

function editor(id: number, path: string, workspaceEnv?: WorkspaceEnv): Tab {
  return { id, kind: "editor", path, workspaceEnv } as Tab;
}

describe("collectEditorWatchGroups", () => {
  it("keeps local, UNC and WSL documents in separate filesystem groups", () => {
    const groups = collectEditorWatchGroups(
      [
        editor(1, "C:/repo/a.ts", { kind: "local" }),
        editor(2, "//server/share/b.ts", { kind: "wsl", distro: "Ubuntu" }),
        editor(3, "/home/serge/c.ts", { kind: "wsl", distro: "Ubuntu" }),
      ],
      { kind: "local" },
    );

    expect([...groups.values()].map((group) => group.workspace.kind).sort()).toEqual([
      "local",
      "wsl",
    ]);
    const localPaths = [...groups.values()].find(
      (group) => group.workspace.kind === "local",
    )?.paths;
    expect(localPaths).toEqual(
      new Set(["C:/repo", "//server/share"]),
    );
  });
});
