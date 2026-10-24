import { expect, it } from "vitest";
import {
  explorerCanReveal,
  sameExplorerFilesystem,
  tabExplorerTarget,
  TAB_EXPLORER_COMMAND,
} from "@/modules/explorer/lib/tabExplorerTarget";
import { declaredCommandSurfaceRule } from "@/modules/shortcuts/lib/commandSurface";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { EditorTab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const ssh = (id = "a", host = "build.example"): WorkspaceEnv => ({
  kind: "ssh",
  root: "/srv/app",
  sessionId: 7,
  connection: { id, name: id, host },
});
const editor = (path: string, workspaceEnv?: WorkspaceEnv): EditorTab => ({
  ...createTabIdentity("main", () => "editor"),
  id: 1,
  kind: "editor",
  spaceId: "main",
  title: "file",
  path,
  workspaceEnv,
  dirty: false,
  preview: false,
});
const terminal = (cwd: string, workspaceEnv?: WorkspaceEnv): TerminalTab => ({
  ...createTabIdentity("main", () => "terminal"),
  id: 2,
  kind: "terminal",
  spaceId: "main",
  title: "shell",
  cwd,
  workspaceEnv,
  paneTree: { kind: "leaf", id: 10 },
  activeLeafId: 10,
});

it("declares sidebar reveal for every pointed surface type", () => {
  expect(declaredCommandSurfaceRule(TAB_EXPLORER_COMMAND)?.appliesTo).toEqual([
    "terminal",
    "harness",
    "editor",
    "other",
  ]);
});

it.each<WorkspaceEnv>([
  LOCAL_WORKSPACE,
  ssh(),
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])("preserves a $kind document's captured filesystem", (workspace) => {
  const target = tabExplorerTarget(
    editor("/work/a.ts", workspace),
    ssh("other"),
  );
  expect(target?.workspace).toBe(workspace);
  expect(target?.directory).toBe(false);
  if (!target) throw new Error("Missing target.");
  expect(explorerCanReveal(target, "/work", workspace)).toBe(true);
});

it("keeps Windows native documents local even inside a remote space", () => {
  for (const path of ["C:/work/a.ts", "\\\\server\\share\\a.ts"]) {
    expect(tabExplorerTarget(editor(path, ssh()), ssh())?.workspace).toBe(
      LOCAL_WORKSPACE,
    );
  }
  expect(
    tabExplorerTarget(terminal("C:/remote", ssh()), LOCAL_WORKSPACE)?.workspace
      .kind,
  ).toBe("ssh");
});

it("matches SSH filesystem identity without confusing helpers, roots or changed hosts", () => {
  const first = ssh();
  if (first.kind !== "ssh") throw new Error("Missing SSH fixture.");
  expect(
    sameExplorerFilesystem(first, { ...first, root: "/", sessionId: 8 }),
  ).toBe(true);
  expect(sameExplorerFilesystem(first, ssh("a", "other.example"))).toBe(false);
  expect(
    sameExplorerFilesystem(first, {
      ...first,
      connection: { ...first.connection, user: "other" },
    }),
  ).toBe(false);
  expect(
    sameExplorerFilesystem(first, {
      ...first,
      connection: { ...first.connection, identityFile: "/keys/other" },
    }),
  ).toBe(false);
});

it("keeps remote namespaces independent of ambient local or remote workspace state", () => {
  const target = tabExplorerTarget(
    editor("remote://machine/srv/a.ts", ssh()),
    LOCAL_WORKSPACE,
  );
  if (!target) throw new Error("Missing target.");
  expect(
    explorerCanReveal(target, "remote://machine/srv", LOCAL_WORKSPACE),
  ).toBe(true);
  expect(explorerCanReveal(target, "remote://other/srv", LOCAL_WORKSPACE)).toBe(
    false,
  );
  expect(explorerCanReveal(target, "/srv", LOCAL_WORKSPACE)).toBe(false);
  const harness = {
    ...createTabIdentity("main", () => "harness"),
    id: 3,
    kind: "harness" as const,
    title: "Harness",
    cwd: "/work",
    spaceId: "main",
  };
  expect(tabExplorerTarget(harness, ssh())?.workspace).toBe(LOCAL_WORKSPACE);
});

it("resolves relative Git file paths against the owning repository", () => {
  const source = editor("src/a.ts", ssh());
  expect(
    tabExplorerTarget(
      {
        ...source,
        kind: "git-diff",
        repoRoot: "/srv/app",
        mode: "+",
        originalPath: null,
      },
      LOCAL_WORKSPACE,
    )?.path,
  ).toBe("/srv/app/src/a.ts");
});

it("refuses unavailable paths and terminal transports without a filesystem target", () => {
  for (const path of [
    "",
    ".",
    "../file",
    "remote://invalid",
    "/work/\nfile",
    "https://example.test/",
  ])
    expect(tabExplorerTarget(editor(path), LOCAL_WORKSPACE)).toBeNull();
  expect(
    tabExplorerTarget(
      { ...terminal("/work"), collaboration: { mode: "guest" } },
      LOCAL_WORKSPACE,
    ),
  ).toBeNull();
  expect(
    tabExplorerTarget(
      terminal("/work", { kind: "serial", portName: "COM3", baudRate: 115200 }),
      LOCAL_WORKSPACE,
    ),
  ).toBeNull();
});
