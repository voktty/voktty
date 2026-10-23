import { expect, it } from "vitest";
import type { TerminalTab } from "@/modules/tabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { hydrateTabs, serializeTabs } from "@/modules/spaces/lib/serialize";
import {
  repairSessionSnapshot,
  snapshotFromRuntime,
  type RuntimeSessionState,
} from "@/modules/spaces/lib/sessionSnapshot";

function terminal(projectCwd?: string): TerminalTab {
  return {
    id: 1,
    ...createTabIdentity("main", () => "tab-project"),
    spaceId: "main",
    kind: "terminal",
    title: "shell",
    cwd: "/tmp/other",
    projectCwd,
    workspaceEnv: { kind: "local" },
    paneTree: { kind: "leaf", id: 2, cwd: "/tmp/other" },
    activeLeafId: 2,
  };
}
function state(tab: TerminalTab): RuntimeSessionState {
  return {
    tabs: [tab],
    activeTabId: tab.id,
    workspaceContexts: [
      {
        id: "main",
        name: "Main",
        root: "/srv/app",
        env: { kind: "local" },
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    activeWorkspaceContextId: "main",
    viewSpaces: [],
    stripEntries: [{ kind: "standalone", tabKey: tab.tabKey }],
    activeStripItem: { kind: "tab", tabKey: tab.tabKey },
  };
}

it.each(["/srv/app", "C:/Work/App", "//server/share/app"])(
  "round-trips the project independently of the shell cwd in schema2: %s",
  (project) => {
    const original = terminal(project);
    const snapshot = snapshotFromRuntime(state(original));
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.tabs[0]).toMatchObject({
      projectCwd: project,
      tree: { cwd: "/tmp/other" },
    });
    let id = 100;
    const [restored] = hydrateTabs(snapshot.tabs, "main", () => id++);
    expect(restored).toMatchObject({
      tabKey: original.tabKey,
      projectCwd: project,
      cwd: "/tmp/other",
      cold: true,
    });
    expect(restored.id).not.toBe(original.id);
  },
);

it.each([
  null,
  { token: "sensitive-marker" },
  "relative/path",
  "remote://user:password@host/srv/app",
  "remote://build/srv/app",
  "/bad\0path",
  "/".repeat(32769),
])(
  "repairs invalid or transport-mismatched project metadata case %# without losing the tab",
  (value) => {
    const snapshot = snapshotFromRuntime(state(terminal("/srv/app")));
    (snapshot.tabs[0] as unknown as { projectCwd: unknown }).projectCwd = value;
    const repaired = repairSessionSnapshot(snapshot);
    expect(repaired.tabs).toHaveLength(1);
    expect(repaired.tabs[0]).not.toHaveProperty("projectCwd");
    expect(JSON.stringify(repaired.tabs)).not.toContain("sensitive-marker");
    let id = 100;
    const [restored] = hydrateTabs(snapshot.tabs, "main", () => id++);
    expect(restored).not.toHaveProperty("projectCwd");
    expect(restored.kind).toBe("terminal");
  },
);

it("leaves legacy standalone terminals unassociated instead of inferring a project from cwd", () => {
  const [serialized] = serializeTabs([terminal()]);
  expect(serialized).not.toHaveProperty("projectCwd");
  let id = 100;
  const [restored] = hydrateTabs([serialized], "main", () => id++);
  expect(restored).not.toHaveProperty("projectCwd");
});

it("keeps SSH and private terminals excluded while project-aware restore is not connected", () => {
  const ssh: TerminalTab = {
    ...terminal("remote://voktty-ssh-build/srv/app"),
    workspaceEnv: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: 71,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
  };
  expect(
    serializeTabs([ssh, { ...terminal("/srv/app"), private: true }]),
  ).toEqual([]);
  expect(snapshotFromRuntime(state(ssh)).tabs).toEqual([]);
});
