import { describe, expect, it } from "vitest";
import type { Tab } from "./useTabs";
import {
  selectLocalTerminalSpawnContext,
  selectWorkspaceCwd,
} from "./useWorkspaceCwd";

function terminal(id: number, cwd: string, spaceId = "default"): Tab {
  return { id, kind: "terminal", cwd, spaceId } as Tab;
}

function editor(id: number, path: string, spaceId = "default"): Tab {
  return { id, kind: "editor", path, spaceId } as Tab;
}

describe("selectWorkspaceCwd", () => {
  it("uses the active terminal and exposes it as the explorer context", () => {
    const active = terminal(1, "C:/repo");

    expect(selectWorkspaceCwd(active, [active], "C:/Users/serge", undefined)).toEqual({
      explorerRoot: "C:/repo",
      explorerTerminalId: 1,
    });
  });

  it("keeps the last live terminal context while an editor has focus", () => {
    const active = editor(2, "//server/share/slow.js");
    const previous = terminal(1, "C:/repo");

    expect(
      selectWorkspaceCwd(active, [previous, active], "C:/Users/serge", 1),
    ).toEqual({ explorerRoot: "C:/repo", explorerTerminalId: 1 });
  });

  it("never derives the explorer root from an editor path", () => {
    const active = editor(2, "//server/share/slow.js");

    expect(selectWorkspaceCwd(active, [active], "C:/Users/serge", undefined)).toEqual({
      explorerRoot: "C:/Users/serge",
      explorerTerminalId: null,
    });
  });

  it("falls back to another live terminal when the remembered one was closed", () => {
    const active = editor(3, "C:/outside/file.ts");
    const survivor = terminal(2, "/home/serge/project");

    expect(
      selectWorkspaceCwd(active, [survivor, active], "/home/serge", 99),
    ).toEqual({
      explorerRoot: "/home/serge/project",
      explorerTerminalId: 2,
    });
  });

  it("uses the active harness tab cwd as the explorer context", () => {
    const harnessTab = {
      id: 5,
      kind: "harness",
      cwd: "C:/projects/web",
      spaceId: "default",
    } as Tab;

    expect(
      selectWorkspaceCwd(harnessTab, [harnessTab], "C:/Users/serge", undefined),
    ).toEqual({
      explorerRoot: "C:/projects/web",
      explorerTerminalId: 5,
    });
  });
});

describe("selectLocalTerminalSpawnContext", () => {
  it("always creates a generic space terminal in the local home", () => {
    expect(selectLocalTerminalSpawnContext("C:/Users/serge")).toEqual({
      cwd: "C:/Users/serge",
      workspaceEnv: { kind: "local" },
    });
  });

  it("lets the backend choose native home when the frontend has not loaded it", () => {
    expect(selectLocalTerminalSpawnContext(null)).toEqual({
      cwd: undefined,
      workspaceEnv: { kind: "local" },
    });
  });
});
