import { describe, expect, it } from "vitest";
import { createTabIdentity, type Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { terminalCwdTarget } from "./terminalCwd";

const ssh: WorkspaceEnv = {
  kind: "ssh",
  connection: {
    id: "host-1",
    name: "Server",
    host: "server.test",
    port: 22,
    user: "root",
  },
  root: "/root",
  sessionId: 7,
};

function terminalTab(workspaceEnv: WorkspaceEnv): Tab {
  return {
    id: 1,
    ...createTabIdentity("space-1", () => "test"),
    kind: "terminal",
    spaceId: "space-1",
    title: "shell",
    cwd: "/root",
    paneTree: { kind: "leaf", id: 2, cwd: "/root" },
    activeLeafId: 2,
    workspaceEnv,
  };
}

describe("terminalCwdTarget", () => {
  it("updates an SSH terminal cwd without authorizing it locally", () => {
    expect(terminalCwdTarget([terminalTab(ssh)], 2, { kind: "local" })).toEqual(
      { workspaceEnv: ssh, authorizeLocally: false },
    );
  });

  it("authorizes cwd updates for local terminals", () => {
    const local = { kind: "local" } as const;
    expect(terminalCwdTarget([terminalTab(local)], 2, ssh)).toEqual({
      workspaceEnv: local,
      authorizeLocally: true,
    });
  });
});
