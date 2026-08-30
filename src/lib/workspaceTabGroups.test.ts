import { describe, expect, it } from "vitest";
import { leaf, newTab, type WorkspaceTab } from "./layout";
import type { Session } from "./session";
import {
  applyDeletedSessionToWorkspace,
  filterTabsForProject,
  findTabForProject,
  planWorkspaceTabClose,
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

describe("planWorkspaceTabClose", () => {
  const sessions = [
    session("m1", "/projects/monocode"),
    session("r1", "/projects/ruler"),
    session("m2", "/projects/monocode"),
  ];
  const tabs = [tab("tm1", "m1"), tab("tr1", "r1"), tab("tm2", "m2")];

  it("uses the global neighbor in workspace scope", () => {
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "tm2",
        scope: "workspace",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
  });

  it("prefers the previous same-project tab in project scope", () => {
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "tm2",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tm1" });
  });

  it("uses the next same-project tab when none exists to the left", () => {
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "tm1",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tm2" });
  });

  it("keeps the last tab of a project instead of jumping to another", () => {
    expect(
      planWorkspaceTabClose({
        tabs: tabs.slice(0, 2),
        sessions,
        closingTabId: "tm1",
        scope: "project",
      }),
    ).toEqual({ action: "keep" });
  });

  it("still jumps across projects in workspace scope when a project is emptied", () => {
    expect(
      planWorkspaceTabClose({
        tabs: tabs.slice(0, 2),
        sessions,
        closingTabId: "tm1",
        scope: "workspace",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
  });

  it("uses the global neighbor for a projectless tab", () => {
    const projectlessSessions = [
      ...sessions,
      session("blank1", "~"),
      session("blank2", "~"),
    ];
    expect(
      planWorkspaceTabClose({
        tabs: [tab("projectless", "blank1"), tabs[1]],
        sessions: projectlessSessions,
        closingTabId: "projectless",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
    expect(
      planWorkspaceTabClose({
        tabs: [tab("blank1", "blank1"), tabs[1], tab("blank2", "blank2")],
        sessions: projectlessSessions,
        closingTabId: "blank2",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
  });

  it("keeps the sole tab or an unknown tab", () => {
    expect(
      planWorkspaceTabClose({
        tabs: [tabs[0]],
        sessions,
        closingTabId: "tm1",
        scope: "workspace",
      }),
    ).toEqual({ action: "keep" });
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "missing",
        scope: "project",
      }),
    ).toEqual({ action: "keep" });
  });
});

describe("applyDeletedSessionToWorkspace", () => {
  const sessions = [
    session("m1", "/projects/monocode"),
    session("r1", "/projects/ruler"),
    session("m2", "/projects/monocode"),
  ];
  const tabs = [tab("tm1", "m1"), tab("tr1", "r1"), tab("tm2", "m2")];

  function replacementFrom(seed: Session | undefined): Session {
    return session("replacement", seed?.cwd ?? "/tmp/fallback");
  }

  it("stays in the project when deleting its last open tab in project scope", () => {
    const next = applyDeletedSessionToWorkspace({
      tabs: [tab("tr1", "r1"), tab("tm1", "m1")],
      sessions: sessions.slice(0, 2),
      sessionId: "m1",
      activeTabId: "tm1",
      scope: "project",
      createReplacement: replacementFrom,
    });
    expect(next.activeTabId).toBe("tm1");
    expect(next.tabs.map((entry) => entry.id)).toEqual(["tr1", "tm1"]);
    expect(next.tabs[1]?.focusedId).toBe("replacement");
    expect(next.sessions.map((entry) => entry.id)).toEqual(["r1", "replacement"]);
  });

  it("activates the previous same-project tab in project scope", () => {
    const next = applyDeletedSessionToWorkspace({
      tabs,
      sessions,
      sessionId: "m2",
      activeTabId: "tm2",
      scope: "project",
      createReplacement: replacementFrom,
    });
    expect(next.activeTabId).toBe("tm1");
    expect(next.tabs.map((entry) => entry.id)).toEqual(["tm1", "tr1"]);
  });

  it("activates the next same-project tab when none exists to the left", () => {
    const next = applyDeletedSessionToWorkspace({
      tabs,
      sessions,
      sessionId: "m1",
      activeTabId: "tm1",
      scope: "project",
      createReplacement: replacementFrom,
    });
    expect(next.activeTabId).toBe("tm2");
    expect(next.tabs.map((entry) => entry.id)).toEqual(["tr1", "tm2"]);
  });

  it("jumps to the global neighbor in workspace scope", () => {
    const next = applyDeletedSessionToWorkspace({
      tabs: tabs.slice(0, 2),
      sessions,
      sessionId: "m1",
      activeTabId: "tm1",
      scope: "workspace",
      createReplacement: replacementFrom,
    });
    expect(next.activeTabId).toBe("tr1");
    expect(next.tabs.map((entry) => entry.id)).toEqual(["tr1"]);
  });

  it("keeps a split tab when only one pane is deleted", () => {
    const split: WorkspaceTab = {
      ...tab("split", "m1"),
      layout: {
        type: "split",
        id: "s",
        dir: "right",
        children: [leaf("m1"), leaf("m2")],
        sizes: [0.5, 0.5],
      },
      focusedId: "m1",
    };
    const next = applyDeletedSessionToWorkspace({
      tabs: [split, tab("tr1", "r1")],
      sessions,
      sessionId: "m1",
      activeTabId: "split",
      scope: "project",
      createReplacement: replacementFrom,
    });
    expect(next.activeTabId).toBe("split");
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[0]?.focusedId).toBe("m2");
    expect(next.sessions.map((entry) => entry.id)).toEqual(["r1", "m2"]);
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
