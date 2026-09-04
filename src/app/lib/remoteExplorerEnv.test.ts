import type { WorkspaceEnv } from "@/modules/workspace";
import { describe, expect, it, vi } from "vitest";
import {
  explorerNavigationScopeKey,
  planRemoteExplorerSessionRelease,
  prepareRemoteExplorerEnv,
} from "./remoteExplorerEnv";

const remote: Extract<WorkspaceEnv, { kind: "ssh" }> = {
  kind: "ssh",
  connection: {
    id: "host-1",
    name: "Server",
    host: "server.test",
    user: "root",
  },
  root: "/root",
  sessionId: 7,
};

describe("prepareRemoteExplorerEnv", () => {
  it("opens an explorer session when remote workspace is not yet connected", async () => {
    const disconnectedRemote = { ...remote, sessionId: undefined };
    const open = vi.fn(async () => ({
      session_id: 9,
      architecture: "x86_64",
      workspace_root: "/opt/data",
      helper_version: "1.0.0",
      capabilities: [],
    }));

    await expect(
      prepareRemoteExplorerEnv(disconnectedRemote, "/opt/data", open),
    ).resolves.toEqual({
      workspaceEnv: { ...remote, root: "/opt/data", sessionId: 9 },
      opened: true,
    });
    expect(open).toHaveBeenCalledWith(remote.connection, "/opt/data");
  });

  it("reuses the active remote session for any remote directory", async () => {
    const open = vi.fn();
    await expect(
      prepareRemoteExplorerEnv(remote, "/opt/data", open),
    ).resolves.toEqual({ workspaceEnv: remote, opened: false });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not create a remote session for local workspaces", async () => {
    const local = { kind: "local" } as const;
    const open = vi.fn();
    await expect(
      prepareRemoteExplorerEnv(local, "C:/project", open),
    ).resolves.toEqual({ workspaceEnv: local, opened: false });
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps a remote explorer session while another tab still references it", () => {
    const environments = new Map<number, WorkspaceEnv>([
      [1, remote],
      [2, remote],
    ]);
    expect(planRemoteExplorerSessionRelease(environments, [1])).toEqual([]);
  });

  it("closes a shared remote explorer session once after its last references close", () => {
    const environments = new Map<number, WorkspaceEnv>([
      [1, remote],
      [2, remote],
      [3, { ...remote, sessionId: 9 }],
    ]);
    expect(planRemoteExplorerSessionRelease(environments, [1, 2, 3])).toEqual([
      7, 9,
    ]);
  });
});

describe("explorerNavigationScopeKey", () => {
  it("keeps manual navigation stable when an SSH explorer broadens its root", () => {
    expect(explorerNavigationScopeKey(remote)).toBe(
      explorerNavigationScopeKey({ ...remote, root: "/", sessionId: 9 }),
    );
  });

  it("still separates different SSH connections", () => {
    expect(explorerNavigationScopeKey(remote)).not.toBe(
      explorerNavigationScopeKey({
        ...remote,
        connection: { ...remote.connection, id: "host-2" },
      }),
    );
  });
});
