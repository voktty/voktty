import { expect, it } from "vitest";
import {
  groupProjectTabs,
  tabProject,
} from "@/modules/spaces/lib/projectTabGroups";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { TerminalTab } from "@/modules/tabs/lib/useTabs";

function terminal(
  id: number,
  projectCwd?: string,
  patch: Partial<TerminalTab> = {},
): TerminalTab {
  return {
    id,
    ...createTabIdentity("main", () => String(id)),
    kind: "terminal",
    spaceId: "main",
    title: "shell",
    projectCwd,
    cwd: "/elsewhere",
    paneTree: { kind: "leaf", id: id + 100 },
    activeLeafId: id + 100,
    ...patch,
  };
}

it("groups explicit project associations across visual workspaces without mutating resources", () => {
  const one = terminal(1, "/work/a");
  const two = terminal(2, "/work/b");
  const three = terminal(3, "/work/a", { spaceId: "other" });
  const loose = terminal(4);
  const tabs = [one, loose, two, three];
  const before = structuredClone(tabs);
  const groups = groupProjectTabs(tabs);
  expect(groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
    [1, 3],
    [2],
    [4],
  ]);
  expect(groups.map((group) => group.project?.name)).toEqual([
    "a",
    "b",
    undefined,
  ]);
  expect(groups[0].tabs[0]).toBe(one);
  expect(tabs).toEqual(before);
});

it("uses strip order for project groups and their members", () => {
  const tabs = [terminal(1, "/a"), terminal(2, "/b"), terminal(3, "/a")];
  const groups = groupProjectTabs(
    tabs,
    [tabs[1], tabs[2], tabs[0]].map((tab) => ({
      kind: "standalone",
      tabKey: tab.tabKey,
    })),
  );
  expect(groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
    [2],
    [3, 1],
  ]);
});

it("does not associate ordinary terminals from their shell cwd", () => {
  expect(
    tabProject(terminal(1, undefined, { cwd: "/work/a" })),
  ).toBeUndefined();
  expect(groupProjectTabs([])).toEqual([]);
});

it.each(["C:/Work/App", "//files/share/App"])(
  "normalizes Windows project identity for %s",
  (project) => {
    const tabs = [
      terminal(1, project),
      terminal(2, `${project.toLowerCase()}/`),
    ];
    expect(groupProjectTabs(tabs)).toHaveLength(1);
    expect(groupProjectTabs(tabs)[0].project?.cwd).toBe(project);
  },
);

it("keeps POSIX case, parent folders and identical names in different roots distinct", () => {
  const projects = ["/work/App", "/work/app", "/other/app", "/work"];
  expect(
    groupProjectTabs(
      projects.map((project, index) => terminal(index, project)),
    ),
  ).toHaveLength(4);
});

it("keeps host namespaces distinct while grouping unresolved and live descriptors for the same remote project", () => {
  const project = "remote://voktty-ssh-build/srv/app";
  const tabs = [
    terminal(1, project, {
      workspaceEnv: {
        kind: "ssh",
        root: "/srv/app",
        connection: { id: "build", name: "Build", host: "" },
        restoredProjectCwd: project,
      },
    }),
    terminal(2, project, {
      workspaceEnv: {
        kind: "ssh",
        root: "/canonical/app",
        sessionId: 8,
        connection: { id: "build", name: "Build", host: "build.example.test" },
      },
    }),
    terminal(3, "remote://voktty-ssh-other/srv/app"),
    terminal(4, "/srv/app"),
  ];
  expect(
    groupProjectTabs(tabs).map((group) => group.tabs.map((tab) => tab.id)),
  ).toEqual([[1, 2], [3], [4]]);
});

it("keeps typed local, WSL and Docker filesystem identities separate", () => {
  const tabs = [
    terminal(1, "/work/app"),
    terminal(2, "/work/app", {
      workspaceEnv: { kind: "wsl", distro: "Ubuntu" },
    }),
    terminal(3, "/work/app", {
      workspaceEnv: { kind: "wsl", distro: "Debian" },
    }),
    terminal(4, "/work/app", {
      workspaceEnv: {
        kind: "docker",
        connection: {
          containerId: "one",
          containerName: "One",
          image: "build",
        },
      },
    }),
  ];
  expect(groupProjectTabs(tabs)).toHaveLength(4);
});

it.each([
  { projectCwd: "relative" },
  { projectCwd: "remote://voktty-ssh-%zz/srv/app" },
  { projectCwd: "remote://user:password@host/srv/app" },
  { projectCwd: "/srv/app", private: true },
  { projectCwd: "/srv/app", collaboration: { mode: "guest" as const } },
])(
  "leaves an invalid or excluded project association ungrouped %#",
  (patch) => {
    expect(tabProject(terminal(1, "/srv/app", patch))).toBeUndefined();
  },
);
