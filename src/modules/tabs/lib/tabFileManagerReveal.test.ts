import { expect, it } from "vitest";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import {
  FILE_MANAGER_COMMAND,
  tabFileManagerRevealPath,
} from "@/modules/tabs/lib/tabFileManagerReveal";
import { declaredCommandSurfaceRule } from "@/modules/shortcuts/lib/commandSurface";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";

const local: WorkspaceEnv = { kind: "local" };
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/srv/app",
  connection: { id: "build", name: "Build", host: "build.example" },
};
const terminal = (cwd: string, workspaceEnv?: WorkspaceEnv): TerminalTab => ({
  ...createTabIdentity("main", () => "one"),
  id: 1,
  kind: "terminal",
  spaceId: "main",
  title: "shell",
  cwd,
  workspaceEnv,
  paneTree: { kind: "leaf", id: 10 },
  activeLeafId: 10,
});
const tabKinds = (path: string): Tab[] => [
  terminal(path, local),
  {
    ...createTabIdentity("main", () => "two"),
    id: 2,
    kind: "harness",
    title: "Harness",
    spaceId: "main",
    cwd: path,
  },
  {
    ...createTabIdentity("main", () => "three"),
    id: 3,
    kind: "editor",
    title: "file",
    spaceId: "main",
    path,
    dirty: false,
    preview: false,
    workspaceEnv: local,
  },
  {
    ...createTabIdentity("main", () => "four"),
    id: 4,
    kind: "git-history",
    title: "Git",
    spaceId: "main",
    repoRoot: path,
    workspaceEnv: local,
  },
];

it("declares the file manager command for every target surface", () => {
  expect(declaredCommandSurfaceRule(FILE_MANAGER_COMMAND)?.appliesTo).toEqual([
    "terminal",
    "harness",
    "editor",
    "other",
  ]);
});

it.each(["/work/app", "C:/work/app", "\\\\server\\share\\app"])(
  "keeps the exact native path %s across surface types",
  (path) => {
    for (const tab of tabKinds(path)) {
      expect(tabFileManagerRevealPath(tab, ssh, !path.startsWith("/"))).toBe(
        path,
      );
    }
  },
);

it.each<WorkspaceEnv>([
  ssh,
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
  { kind: "serial", portName: "COM3", baudRate: 115200 },
])("does not reinterpret $kind paths as native locations", (env) => {
  expect(
    tabFileManagerRevealPath(terminal("/work/app", env), local, false),
  ).toBeNull();
  expect(
    tabFileManagerRevealPath(terminal("/work/app"), env, false),
  ).toBeNull();
  const editor = tabKinds("/work/app")[2];
  expect(
    tabFileManagerRevealPath(
      { ...editor, workspaceEnv: env } as Tab,
      local,
      false,
    ),
  ).toBeNull();
});

it("uses a terminal's own environment ahead of its owning workspace", () => {
  expect(
    tabFileManagerRevealPath(terminal("/work/app", local), ssh, false),
  ).toBe("/work/app");
  expect(
    tabFileManagerRevealPath(terminal("C:/remote/app", ssh), local, true),
  ).toBeNull();
});

it("preserves native Windows documents and WSL UNC paths without mapping remote POSIX paths", () => {
  const editor = tabKinds("C:/work/app")[2];
  expect(
    tabFileManagerRevealPath(
      { ...editor, workspaceEnv: ssh } as Tab,
      ssh,
      true,
    ),
  ).toBe("C:/work/app");
  expect(
    tabFileManagerRevealPath(
      terminal("\\\\wsl.localhost\\Ubuntu\\home\\dev", {
        kind: "wsl",
        distro: "Ubuntu",
      }),
      local,
      true,
    ),
  ).toBe("\\\\wsl.localhost\\Ubuntu\\home\\dev");
  expect(
    tabFileManagerRevealPath(terminal("/home/dev", local), local, true),
  ).toBeNull();
});

it.each([
  "remote://machine/work/app",
  "https://example.test/app",
  ".",
  "../app",
  "~",
  "C:app",
  "/work/\napp",
  "//server/share",
])("refuses nonnative or ambiguous paths: %s", (path) => {
  for (const tab of tabKinds(path))
    expect(tabFileManagerRevealPath(tab, local, false)).toBeNull();
});

it("rejects guest-terminal locations even if their host reported a native-looking path", () => {
  expect(
    tabFileManagerRevealPath(
      { ...terminal("/work/app", local), collaboration: { mode: "guest" } },
      local,
      false,
    ),
  ).toBeNull();
});
