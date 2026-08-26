import { describe, expect, it } from "vitest";
import {
  documentWorkspaceKey,
  isWslWorkspacePath,
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  workspaceEnvForNativePty,
  workspaceForDocumentPath,
  workspaceForNativeFs,
  workspaceScopeKey,
} from "./env";

describe("workspace filesystem routing", () => {
  it("recognizes POSIX paths used by WSL", () => {
    expect(isWslWorkspacePath("/home/serge")).toBe(true);
    expect(isWslWorkspacePath("/mnt/c/project")).toBe(true);
    expect(isWslWorkspacePath("C:/project")).toBe(false);
    expect(isWslWorkspacePath("\\\\wsl$\\Ubuntu\\home\\serge")).toBe(false);
  });

  it("keeps WSL paths on the native filesystem bridge", () => {
    const wsl = { kind: "wsl" as const, distro: "Ubuntu" };
    const ssh = {
      kind: "ssh" as const,
      connection: { id: "server-1", name: "Server", host: "server.example" },
      root: "/srv/app",
    };

    expect(workspaceForNativeFs(wsl, "/home/serge/project")).toEqual(wsl);
    expect(workspaceForNativeFs(ssh, "/srv/app/project")).toEqual(
      LOCAL_WORKSPACE,
    );
    expect(workspaceForNativeFs(LOCAL_WORKSPACE, "C:/project")).toEqual(
      LOCAL_WORKSPACE,
    );
  });

  it("resolves document ownership without leaking the active environment", () => {
    const wsl = { kind: "wsl" as const, distro: "Ubuntu" };
    const ssh = {
      kind: "ssh" as const,
      connection: { id: "server-1", name: "Server", host: "server.example" },
      root: "/srv/app",
    };

    expect(workspaceForDocumentPath(wsl, "/home/serge/app.ts")).toEqual(wsl);
    expect(workspaceForDocumentPath(wsl, "\\\\server\\share\\app.ts")).toEqual(
      LOCAL_WORKSPACE,
    );
    expect(workspaceForDocumentPath(ssh, "/srv/app/main.ts")).toEqual(ssh);
    expect(workspaceForDocumentPath(ssh, "C:/project/main.ts")).toEqual(
      LOCAL_WORKSPACE,
    );
  });

  it("includes filesystem identity in document keys", () => {
    expect(
      documentWorkspaceKey(
        { kind: "wsl", distro: "Ubuntu" },
        "/home/serge/app.ts",
      ),
    ).not.toBe(
      documentWorkspaceKey(
        { kind: "wsl", distro: "Debian" },
        "/home/serge/app.ts",
      ),
    );
    expect(
      documentWorkspaceKey(
        { kind: "wsl", distro: "Ubuntu" },
        "\\\\SERVER\\Share\\App.ts",
      ),
    ).toBe(documentWorkspaceKey(LOCAL_WORKSPACE, "//server/share/app.ts"));
  });

  it("flattens Docker connection fields only at the native PTY boundary", () => {
    expect(
      workspaceEnvForNativePty({
        kind: "docker",
        connection: {
          containerId: "container-1",
          containerName: "api",
          image: "node:22",
          shell: "/bin/sh",
          workdir: "/app",
        },
      }),
    ).toEqual({
      kind: "docker",
      containerId: "container-1",
      containerName: "api",
      image: "node:22",
      shell: "/bin/sh",
      workdir: "/app",
    });
    expect(workspaceEnvForNativePty(LOCAL_WORKSPACE)).toBe(LOCAL_WORKSPACE);
  });

  it("tracks simultaneous connection attempts independently", () => {
    useWorkspaceEnvStore.setState({ connectionAttempts: {} });
    const first = {
      kind: "ssh" as const,
      connection: { id: "one", name: "One", host: "one.example" },
      root: "/srv/one",
    };
    const second = {
      kind: "ssh" as const,
      connection: { id: "two", name: "Two", host: "two.example" },
      root: "/srv/two",
    };

    useWorkspaceEnvStore.getState().beginConnection(first, "One");
    useWorkspaceEnvStore.getState().beginConnection(second, "Two");
    useWorkspaceEnvStore
      .getState()
      .failConnection(first, "One", "connection refused");

    const attempts = useWorkspaceEnvStore.getState().connectionAttempts;
    expect(attempts[workspaceScopeKey(first)]?.state).toMatchObject({
      phase: "failed",
      error: "connection refused",
    });
    expect(attempts[workspaceScopeKey(second)]?.state.phase).toBe("resolving");

    useWorkspaceEnvStore.getState().clearConnection(first);
    expect(
      useWorkspaceEnvStore.getState().connectionAttempts[
        workspaceScopeKey(first)
      ],
    ).toBeUndefined();
  });
});
