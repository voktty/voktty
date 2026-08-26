import { describe, expect, it } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";
import { reusableWorkspaceEnv } from "./workspaceActivation";

describe("reusableWorkspaceEnv", () => {
  it("reuses the current local environment", () => {
    const current = { kind: "local" } as const;
    expect(reusableWorkspaceEnv({ kind: "local" }, current)).toBe(current);
  });

  it("reuses a connected SSH session for the same workspace", () => {
    const connection = {
      id: "host-1",
      name: "Server",
      host: "server.test",
      port: 22,
      user: "root",
    };
    const current: WorkspaceEnv = {
      kind: "ssh",
      connection,
      root: "/opt/data",
      sessionId: 42,
    };
    expect(
      reusableWorkspaceEnv(
        { kind: "ssh", connection, root: "/opt/data" },
        current,
      ),
    ).toBe(current);
  });

  it("does not reuse a disconnected SSH workspace", () => {
    const connection = {
      id: "host-1",
      name: "Server",
      host: "server.test",
      port: 22,
      username: "root",
    };
    const current: WorkspaceEnv = {
      kind: "ssh",
      connection,
      root: "/root",
    };
    expect(reusableWorkspaceEnv(current, current)).toBeNull();
  });
});
