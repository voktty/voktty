import { describe, expect, it } from "vitest";
import { newTab, type WorkspaceTab } from "./layout";
import type { Session } from "./session";
import {
  filterTabsForProject,
  findTabForProject,
  replaceGroupInTabOrder,
  workspaceTabProject,
} from "./workspaceTabGroups";

function session(id: string, cwd: string): Session {
  return {
    id,
    cwd,
    harness: "cursor",
    title: "",
    blocks: [],
    busy: false,
    model: "",
  };
}

function tab(id: string, sessionId: string): WorkspaceTab {
  return { ...newTab(sessionId), id };
}

describe("workspaceTabProject", () => {
  it("reads project from the tab session cwd", () => {
    const workspace = tab("t1", "s1");
    const sessions = [session("s1", "/Users/me/agent-terminal")];
    expect(workspaceTabProject(workspace, sessions)).toBe("agent-terminal");
  });
});

describe("findTabForProject", () => {
  it("matches a tab by project path, ignoring trailing slashes", () => {
    const tabs = [tab("t1", "s1"), tab("t2", "s2")];
    const sessions = [
      session("s1", "/tmp/alpha"),
      session("s2", "/tmp/beta"),
    ];
    expect(findTabForProject(tabs, sessions, "/tmp/beta/")?.id).toBe("t2");
  });

  it("returns undefined when no open tab belongs to the project", () => {
    const tabs = [tab("t1", "s1")];
    const sessions = [session("s1", "/tmp/alpha")];
    expect(findTabForProject(tabs, sessions, "/tmp/beta")).toBeUndefined();
  });
});

describe("filterTabsForProject", () => {
  it("keeps only tabs that belong to the project", () => {
    const tabs = [tab("t1", "s1"), tab("t2", "s2"), tab("t3", "s3")];
    const sessions = [
      session("s1", "/tmp/alpha"),
      session("s2", "/tmp/beta"),
      session("s3", "/tmp/beta"),
    ];
    expect(
      filterTabsForProject(tabs, sessions, "/tmp/beta").map((tab) => tab.id),
    ).toEqual(["t2", "t3"]);
  });
});

describe("replaceGroupInTabOrder", () => {
  it("swaps a contiguous slice of ids", () => {
    expect(replaceGroupInTabOrder(["a", "b", "c", "d"], 1, 2, ["d", "c"])).toEqual([
      "a",
      "d",
      "c",
      "d",
    ]);
  });
});
