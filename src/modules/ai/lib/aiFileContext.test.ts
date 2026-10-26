import { expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { resolveAiFileContext } from "@/modules/ai/lib/aiFileContext";
import type { WorkspaceEnv } from "@/modules/workspace";
import { asTabKey, asWorkspaceScopeId } from "@/modules/tabs/lib/tabIdentity";

const editor = (path: string, workspaceEnv?: WorkspaceEnv): Tab =>
  ({ id: 1, kind: "editor", path, workspaceEnv }) as Tab;
it("keeps a legacy editor local and preserves its POSIX filename separators", () => {
  expect(resolveAiFileContext(editor("/repo/name\\part.ts"))).toEqual({
    directory: "/repo",
    workspace: { kind: "local" },
  });
});
it("retains the owning WSL distribution", () => {
  expect(
    resolveAiFileContext(
      editor("/repo/file.ts", { kind: "wsl", distro: "fixture" }),
    ),
  ).toEqual({
    directory: "/repo",
    workspace: { kind: "wsl", distro: "fixture" },
  });
});
it("keeps Windows documents native even from a remote workspace", () => {
  expect(
    resolveAiFileContext(
      editor("C:\\repo\\file.ts", { kind: "wsl", distro: "fixture" }),
    ),
  ).toEqual({ directory: "C:/repo", workspace: { kind: "local" } });
});
it("uses the terminal runtime filesystem instead of its stale launch descriptor", () => {
  const terminal: Tab = {
    spaceId: "fixture",
    tabKey: asTabKey("tab-fixture"),
    workspaceScopeId: asWorkspaceScopeId("fixture"),
    title: "Fixture",
    id: 1,
    kind: "terminal",
    cwd: "/repo",
    paneTree: { kind: "leaf", id: 1, cwd: "/repo" },
    activeLeafId: 1,
    workspaceEnv: { kind: "local" },
  };
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    connection: { id: "fixture", name: "Fixture", host: "fixture.invalid" },
    root: "/repo",
    sessionId: 7,
  };
  const result = resolveAiFileContext(terminal, workspace);
  expect(result).toEqual({ directory: "/repo", workspace });
  workspace.connection.host = "replacement.invalid";
  expect(result?.workspace).not.toEqual(workspace);
});
it("does not borrow another directory for unavailable or unresolved sources", () => {
  expect(resolveAiFileContext(undefined)).toBeNull();
  expect(
    resolveAiFileContext(editor("remote://fixture/repo/file.ts")),
  ).toBeNull();
  expect(resolveAiFileContext({ id: 1, kind: "harness" } as Tab)).toBeNull();
  expect(
    resolveAiFileContext({
      id: 1,
      kind: "terminal",
      collaboration: { mode: "guest" },
    } as Tab),
  ).toBeNull();
  expect(
    resolveAiFileContext(
      editor("/repo/file.ts", {
        kind: "docker",
        connection: {
          containerId: "fixture",
          containerName: "Fixture",
          image: "fixture",
        },
      }),
    ),
  ).toBeNull();
});
