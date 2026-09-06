import { describe, expect, it } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  releasableSessionId,
  reusableWorkspaceEnv,
} from "./workspaceActivation";

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

  it("does not reuse an SSH workspace when target multiplexer sessions differ", () => {
    const connection1 = {
      id: "host-1",
      name: "Server",
      host: "server.test",
      port: 22,
      user: "root",
      activeMultiplexerSession: "voktty-1",
    };
    const connection2 = {
      ...connection1,
      activeMultiplexerSession: "voktty-2",
    };
    const current: WorkspaceEnv = {
      kind: "ssh",
      connection: connection1,
      root: "/opt/data",
      sessionId: 42,
    };
    expect(
      reusableWorkspaceEnv(
        { kind: "ssh", connection: connection2, root: "/opt/data" },
        current,
      ),
    ).toBeNull();
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

describe("releasableSessionId", () => {
  const connection = {
    id: "host-1",
    name: "Server",
    host: "server.test",
    port: 22,
    user: "root",
  };

  const sshEnv = (sessionId?: number): WorkspaceEnv => ({
    kind: "ssh",
    connection,
    root: "/home/root",
    sessionId,
  });

  it("releases a session this activation opened", () => {
    expect(releasableSessionId(sshEnv(7), 7)).toBe(7);
  });

  it("keeps a session borrowed from the active workspace", () => {
    // The borrowed env is a fresh object carrying someone else's session id.
    // Closing it is what left the other tabs on "remote session not found".
    expect(releasableSessionId(sshEnv(7), undefined)).toBeUndefined();
  });

  it("keeps a session that arrived on the requested env", () => {
    expect(releasableSessionId(sshEnv(42), undefined)).toBeUndefined();
  });

  it("does not release when the prepared env moved to another session", () => {
    expect(releasableSessionId(sshEnv(9), 7)).toBeUndefined();
  });

  it("ignores environments that hold no remote session", () => {
    expect(releasableSessionId({ kind: "local" }, 7)).toBeUndefined();
    expect(releasableSessionId({ kind: "wsl", distro: "Ubuntu" }, 7)).toBe(
      undefined,
    );
  });
});
