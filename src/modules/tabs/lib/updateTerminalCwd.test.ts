import { describe, expect, it, vi } from "vitest";
import { remoteReadDir, remoteRelativePath } from "@/modules/remote/filesystem";
import { prepareRemoteExplorerEnv } from "@/app/lib/remoteExplorerEnv";
import type { WorkspaceEnv } from "@/modules/workspace";
import { createTabIdentity } from "./tabIdentity";
import type { TerminalTab } from "./useTabs";
import { selectWorkspaceCwd } from "./useWorkspaceCwd";
import { updateTerminalCwd } from "./updateTerminalCwd";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: request,
}));

const env: Extract<WorkspaceEnv, { kind: "ssh" }> = {
  kind: "ssh",
  connection: { id: "test-server", name: "Server", host: "server.test" },
  root: "/srv/projects",
  sessionId: 7,
};
const terminal = (): TerminalTab => ({
  ...createTabIdentity("default"),
  id: 1,
  kind: "terminal",
  title: "SSH",
  spaceId: "default",
  cwd: env.root,
  paneTree: { kind: "leaf", id: 2, cwd: env.root },
  activeLeafId: 2,
  workspaceEnv: env,
});

describe("terminal cwd and remote filesystem identity", () => {
  it("lists the new cwd relative to the unchanged helper root after cd", async () => {
    const tab = updateTerminalCwd(terminal(), 2, "/srv/projects/site");
    if (tab.kind !== "terminal") throw new Error("Expected terminal tab");
    expect(tab.workspaceEnv).toBe(env);
    const { explorerRoot } = selectWorkspaceCwd(tab, [tab], null, undefined);
    expect(explorerRoot).toBe("/srv/projects/site");
    request.mockResolvedValueOnce({ entries: [] });
    await remoteReadDir(env, explorerRoot!);
    expect(request).toHaveBeenCalledWith(7, "fs.readDir", { path: "site" });
  });

  it("keeps the session boundary when cd leaves its initial root", async () => {
    const tab = updateTerminalCwd(terminal(), 2, "/opt/site");
    if (tab.kind !== "terminal") throw new Error("Expected terminal tab");
    expect(tab.workspaceEnv).toBe(env);
    expect(remoteRelativePath(env, "/opt/site")).toBe("/opt/site");
    const open = vi.fn(async () => ({
      session_id: 9,
      workspace_root: "/",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    }));
    await prepareRemoteExplorerEnv(env, "/opt/site", open);
    expect(open).toHaveBeenCalledWith(env.connection, "/");
  });

  it("preserves identity on repeated prompts and unrelated leaves", () => {
    const tab = terminal();
    expect(updateTerminalCwd(tab, 2, env.root)).toBe(tab);
    expect(updateTerminalCwd(tab, 99, "/opt/site")).toBe(tab);
  });
});
