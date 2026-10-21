import { describe, expect, it } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";
import { NO_SURFACE, resolveActiveSurface } from "./activeSurface";

const ssh = (profileId: string): WorkspaceEnv => ({
  kind: "ssh",
  connection: { id: profileId, name: profileId, host: "example.test" },
  root: "/srv/app",
});

describe("resolveActiveSurface", () => {
  it("returns the empty surface without input", () => {
    expect(resolveActiveSurface(null)).toBe(NO_SURFACE);
    expect(resolveActiveSurface(undefined)).toBe(NO_SURFACE);
  });

  it("keeps the terminal owner and project distinct from its current folder", () => {
    expect(
      resolveActiveSurface({
        kind: "terminal",
        ownerId: 7,
        projectCwd: "/srv/app",
        cwd: "/srv/other",
        workspaceEnv: { kind: "wsl", distro: "Ubuntu" },
      }),
    ).toEqual({
      kind: "terminal",
      ownerId: 7,
      project: "/srv/app",
      folder: "/srv/other",
      environment: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it.each(["  ", 42, null, undefined])("ignores invalid cwd %s", (cwd) => {
    expect(resolveActiveSurface({ kind: "terminal", cwd }).folder).toBeNull();
  });

  it("prefers the focused Harness folder over its project", () => {
    expect(
      resolveActiveSurface({
        kind: "harness",
        projectCwd: "C:/repo",
        focusFolder: "C:/repo/packages/a",
      }),
    ).toEqual({
      kind: "harness",
      ownerId: null,
      project: "C:/repo",
      folder: "C:/repo/packages/a",
      environment: { kind: "local" },
    });
  });

  it("falls back to the project when nothing is focused", () => {
    expect(
      resolveActiveSurface({ kind: "harness", projectCwd: "C:/repo" }).folder,
    ).toBe("C:/repo");
  });

  it("distinguishes remote namespaces without assuming their transport", () => {
    const surface = (environmentId: string) =>
      resolveActiveSurface({
        kind: "harness",
        projectCwd: `remote://${environmentId}/srv/app`,
        workspaceEnv: { kind: "local" },
      });
    expect(surface("machine-a").environment).toEqual({
      kind: "remote",
      environmentId: "machine-a",
    });
    expect(surface("machine-b").environment).not.toEqual(
      surface("machine-a").environment,
    );
  });

  it("follows a local focused folder even in a remote Harness project", () => {
    expect(
      resolveActiveSurface({
        kind: "harness",
        projectCwd: "remote://machine-a/srv/app",
        focusFolder: "C:/local",
        workspaceEnv: ssh("ssh-a"),
      }).environment,
    ).toEqual({ kind: "local" });
  });

  it.each(["C:/repo", "\\\\server\\share\\repo"])(
    "does not apply an ambient WSL environment to native Harness folder %s",
    (projectCwd) => {
      expect(
        resolveActiveSurface({
          kind: "harness",
          projectCwd,
          workspaceEnv: { kind: "wsl", distro: "Ubuntu" },
        }).environment,
      ).toEqual({ kind: "local" });
    },
  );

  it("distinguishes WSL distributions with the same cwd", () => {
    const surface = (distro: string) =>
      resolveActiveSurface({
        kind: "terminal",
        cwd: "/srv/app",
        workspaceEnv: { kind: "wsl", distro },
      });
    expect(surface("Ubuntu").environment).not.toEqual(
      surface("Debian").environment,
    );
  });

  it("keeps SSH ownership even for terminal paths on a Windows host", () => {
    expect(
      resolveActiveSurface({
        kind: "terminal",
        cwd: "C:/remote/app",
        workspaceEnv: ssh("ssh-a"),
      }).environment,
    ).toEqual({ kind: "ssh", profileId: "ssh-a", root: "/srv/app" });
  });

  it("distinguishes SSH profiles without copying connection credentials", () => {
    const environment = (profileId: string) =>
      resolveActiveSurface({
        kind: "terminal",
        cwd: "/srv/app",
        workspaceEnv: ssh(profileId),
      }).environment;
    expect(environment("ssh-a")).not.toEqual(environment("ssh-b"));
    expect(environment("ssh-a")).not.toHaveProperty("connection");
  });

  it("keeps Docker container identity", () => {
    expect(
      resolveActiveSurface({
        kind: "terminal",
        cwd: "/app",
        workspaceEnv: {
          kind: "docker",
          connection: {
            containerId: "container-a",
            containerName: "app",
            image: "test",
          },
        },
      }).environment,
    ).toEqual({ kind: "docker", containerId: "container-a" });
  });

  it("keeps serial port identity", () => {
    expect(
      resolveActiveSurface({
        kind: "terminal",
        workspaceEnv: { kind: "serial", portName: "COM3", baudRate: 9600 },
      }).environment,
    ).toEqual({ kind: "serial", portName: "COM3" });
  });

  it("does not infer an explorer root from an editor document", () => {
    expect(
      resolveActiveSurface({ kind: "editor", projectCwd: "/workspace" }).folder,
    ).toBeNull();
    expect(
      resolveActiveSurface({
        kind: "editor",
        projectCwd: "/workspace",
        folder: "/explorer/root",
      }).folder,
    ).toBe("/explorer/root");
  });

  it("preserves explicitly supplied context for other surfaces", () => {
    expect(resolveActiveSurface({ kind: "other", folder: "/srv/app" })).toEqual(
      { ...NO_SURFACE, folder: "/srv/app" },
    );
  });
});
