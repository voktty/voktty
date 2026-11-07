import { describe, expect, it } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";
import { isExplorerSourceReachable } from "./sourceReachability";

const ssh = (root: string, sessionId: number | null = 1): WorkspaceEnv =>
  ({
    kind: "ssh",
    root,
    sessionId: sessionId ?? undefined,
    connection: { id: "c", name: "c", host: "h" },
  }) as unknown as WorkspaceEnv;

describe("isExplorerSourceReachable", () => {
  it("accepts paths inside the session root", () => {
    expect(isExplorerSourceReachable(ssh("/home/u/app"), "/home/u/app")).toBe(true);
    expect(isExplorerSourceReachable(ssh("/home/u/app"), "/home/u/app/src")).toBe(true);
  });

  it("rejects a cd above or beside the root", () => {
    expect(isExplorerSourceReachable(ssh("/home/u/app"), "/home/u")).toBe(false);
    expect(isExplorerSourceReachable(ssh("/home/u/app"), "/etc")).toBe(false);
    expect(isExplorerSourceReachable(ssh("/home/u/app"), "/home/u/app2")).toBe(false);
  });

  it("accepts everything under a widened root", () => {
    expect(isExplorerSourceReachable(ssh("/"), "/var/log")).toBe(true);
  });

  it("leaves remote project URIs and unconnected sessions to their own router", () => {
    expect(isExplorerSourceReachable(ssh("/a"), "remote://voktty-ssh-x/b")).toBe(true);
    expect(isExplorerSourceReachable(ssh("/a", null), "/other")).toBe(true);
  });

  it("keeps local behavior and a missing source reachable", () => {
    expect(isExplorerSourceReachable({ kind: "local" } as WorkspaceEnv, "/tmp")).toBe(true);
    expect(isExplorerSourceReachable(ssh("/a"), null)).toBe(true);
  });
});
