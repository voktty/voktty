import { describe, expect, it } from "vitest";
import { teamBoardProject } from "@/modules/teams/lib/teamProject";
import type { WorkspaceEnv } from "@/modules/workspace";

const env: WorkspaceEnv = {
  kind: "ssh", root: "/srv/webserver",
  connection: { id: "mini server", name: "Mini", host: "mini.example.test", port: 22 },
};

describe("team board project selection (E8.0)", () => {
  it("uses the SSH root when the space has no local root", () => {
    expect(teamBoardProject({ root: null, env }, undefined, "C:/Users/test"))
      .toBe("remote://voktty-ssh-mini%20server/srv/webserver");
  });

  it("never interprets a remote project's host path as local", () => {
    expect(teamBoardProject({ root: "C:/stale", env }, "/srv/other", "C:/home"))
      .toBe("remote://voktty-ssh-mini%20server/srv/other");
  });

  it.each(["", ".", "/", "/srv/../escape", "C:/home"])("rejects invalid SSH root %s without a local fallback", (root) => {
    expect(() => teamBoardProject({ root: null, env: { ...env, root } }, undefined, "C:/home"))
      .toThrow("mini.example.test");
  });

  it("preserves explicit namespaces and local project selection", () => {
    expect(teamBoardProject(undefined, "remote://voktty-ssh-conn/srv/app")).toBe("remote://voktty-ssh-conn/srv/app");
    expect(teamBoardProject({ root: "/repo", env: { kind: "local" } }, undefined, "/home/test")).toBe("/repo");
  });

  it("rejects other workspace transports without a local fallback", () => {
    expect(() => teamBoardProject({ root: "/repo", env: { kind: "wsl", distro: "Ubuntu" } }, undefined, "C:/home")).toThrow("wsl");
  });
});
