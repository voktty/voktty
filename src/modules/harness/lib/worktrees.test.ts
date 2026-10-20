import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  checkWorktreeRemoval,
  createWorktree,
  listWorktrees,
  removeWorktree,
} from "./worktrees";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openRemoteWorkspace: vi.fn(),
  closeRemoteWorkspace: vi.fn(),
  remoteMachineFor: vi.fn(),
  remoteProjectForPath: vi.fn(),
  remoteSshConnectionFor: vi.fn(),
  remoteSshConnectionForProfile: vi.fn(),
  sshConnections: [] as Array<Record<string, unknown>>,
  notifyGitChanged: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: mocks.openRemoteWorkspace,
  closeRemoteWorkspace: mocks.closeRemoteWorkspace,
}));
vi.mock("@/modules/connections/model/connections", () => ({
  remoteMachineFor: mocks.remoteMachineFor,
}));
vi.mock("@/modules/connections/model/remoteProjects", () => ({
  parseRemotePath: (path: string) => {
    const match = path.replace(/\\/g, "/").match(/^remote:\/\/([^/]+)\/(.*)$/);
    return match
      ? { environmentId: match[1], hostPath: `/${match[2]}` }
      : undefined;
  },
  remotePath: (environmentId: string, hostPath: string) =>
    `remote://${environmentId}/${hostPath.replace(/^\/+/, "")}`,
  remoteProjectForPath: mocks.remoteProjectForPath,
}));
vi.mock("@/modules/connections/model/remoteSshProfiles", () => ({
  remoteSshConnectionFor: mocks.remoteSshConnectionFor,
  remoteSshConnectionForProfile: mocks.remoteSshConnectionForProfile,
  remoteSshConnectionIdForEnvironment: (environmentId: string) =>
    environmentId.startsWith("voktty-ssh-")
      ? environmentId.slice("voktty-ssh-".length)
      : undefined,
  findSshProfile: (
    environmentId: string,
    savedConnections?: Array<Record<string, unknown>>,
  ) => {
    const list = savedConnections ?? mocks.sshConnections;
    const targetId = environmentId.startsWith("voktty-ssh-")
      ? environmentId.slice("voktty-ssh-".length)
      : environmentId;
    return list.find((c) => c.id === targetId || c.id === environmentId);
  },
}));
vi.mock("./fs", () => ({ notifyGitChanged: mocks.notifyGitChanged }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ sshConnections: mocks.sshConnections }),
  },
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
  isWindowsNativePath: () => false,
  LOCAL_WORKSPACE: { kind: "local" },
}));

const connection = {
  host: "build.example",
  user: "deploy",
  port: 2222,
};
const session = {
  session_id: 41,
  architecture: "x86_64",
  workspace_root: "/srv/app",
  helper_version: "1.0.16",
  capabilities: [],
};
const tree = {
  path: "/srv/app/.git/voktty-worktrees/voktty-feature-123",
  branch: "feature/new",
  head: "abc123",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: null,
  unpushed: null,
  sessionIds: [],
};

beforeEach(async () => {
  await remoteSessions.closeAll();
  vi.clearAllMocks();
  mocks.remoteMachineFor.mockResolvedValue({
    id: "machine-1",
    environmentId: "machine-1",
  });
  mocks.remoteProjectForPath.mockImplementation((path: string) => {
    const match = path.match(/^remote:\/\/([^/]+)\//);
    return match ? { environmentId: match[1], cwd: "/srv/app" } : undefined;
  });
  mocks.remoteSshConnectionFor.mockReturnValue(connection);
  mocks.remoteSshConnectionForProfile.mockReturnValue(connection);
  mocks.sshConnections = [];
  mocks.openRemoteWorkspace.mockResolvedValue(session);
  mocks.closeRemoteWorkspace.mockResolvedValue(undefined);
});

describe("remote Harness worktrees", () => {
  it("lists through Voktty's native SSH helper and remaps host paths", async () => {
    mocks.invoke.mockResolvedValueOnce({
      worktrees: [{ ...tree, path: "/srv/app" }, tree],
      defaultRoot: "/srv/app/.git/voktty-worktrees",
    });

    const result = await listWorktrees("remote://machine-1/srv/app");

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      connection,
      "/srv/app",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("git_worktrees", {
      cwd: "/srv/app",
      workspace: {
        kind: "ssh",
        root: "/srv/app",
        sessionId: session.session_id,
        connection,
      },
    });
    expect(result.defaultRoot).toBe(
      "remote://machine-1/srv/app/.git/voktty-worktrees",
    );
    expect(result.worktrees[1].path).toBe(
      "remote://machine-1/srv/app/.git/voktty-worktrees/voktty-feature-123",
    );
    await remoteSessions.closeAll();
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(session.session_id);
  });

  it("creates on the remote machine and closes the temporary agent session", async () => {
    mocks.invoke.mockResolvedValueOnce(tree);

    const result = await createWorktree(
      "remote://machine-1/srv/app",
      "feature/new",
      "HEAD",
      false,
    );

    expect(mocks.invoke).toHaveBeenCalledWith("git_worktree_create", {
      cwd: "/srv/app",
      branch: "feature/new",
      base: "HEAD",
      existing: false,
      workspace: {
        kind: "ssh",
        root: "/srv/app",
        sessionId: session.session_id,
        connection,
      },
    });
    expect(result.path).toBe(
      "remote://machine-1/srv/app/.git/voktty-worktrees/voktty-feature-123",
    );
    await remoteSessions.closeAll();
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(session.session_id);
    expect(mocks.notifyGitChanged).toHaveBeenCalledOnce();
  });

  it("uses a saved SSH profile without looking up a Host machine", async () => {
    const profile = {
      id: "profile-1",
      name: "Build host",
      host: "build.example",
      user: "deploy",
      port: 2222,
    };
    mocks.sshConnections = [profile];
    mocks.invoke.mockResolvedValueOnce({
      worktrees: [{ ...tree, path: "/srv/app" }],
      defaultRoot: "/srv/app/.git/voktty-worktrees",
    });

    await listWorktrees("remote://voktty-ssh-profile-1/srv/app");

    expect(mocks.remoteMachineFor).not.toHaveBeenCalled();
    expect(mocks.remoteSshConnectionForProfile).toHaveBeenCalledWith(profile);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      connection,
      "/srv/app",
    );
  });

  it("opens the saved project root when listing from one of its worktrees", async () => {
    mocks.invoke.mockResolvedValueOnce({
      worktrees: [{ ...tree, path: "/srv/app" }, tree],
      defaultRoot: "/srv/app/.git/voktty-worktrees",
    });

    await listWorktrees(
      "remote://machine-1/srv/app/.git/voktty-worktrees/voktty-feature-123",
    );

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      connection,
      "/srv/app",
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "git_worktrees",
      expect.objectContaining({ cwd: "/srv/app" }),
    );
  });

  it("deletes a selected remote worktree through the authenticated helper", async () => {
    mocks.sshConnections = [
      {
        id: "profile-1",
        name: "Build host",
        host: "build.example",
        user: "deploy",
        port: 2222,
      },
    ];
    mocks.invoke.mockResolvedValueOnce({ removed: true, reason: null });

    await removeWorktree(
      "remote://voktty-ssh-profile-1/srv/app",
      "remote://voktty-ssh-profile-1/srv/app/.git/voktty-worktrees/voktty-feature-123",
      true,
    );

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      connection,
      "/srv/app",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("git_worktree_delete", {
      cwd: "/srv/app",
      path: "/srv/app/.git/voktty-worktrees/voktty-feature-123",
      force: true,
      workspace: {
        kind: "ssh",
        root: "/srv/app",
        sessionId: session.session_id,
        connection,
      },
    });
    expect(mocks.notifyGitChanged).toHaveBeenCalledOnce();
  });

  it("preflights removal from the native remote worktree list", async () => {
    mocks.invoke.mockResolvedValueOnce({
      worktrees: [
        { ...tree, path: "/srv/app", isMain: true },
        { ...tree, dirty: false },
      ],
      defaultRoot: "/srv/app/.git/voktty-worktrees",
    });

    await checkWorktreeRemoval(
      "remote://machine-1/srv/app",
      "remote://machine-1/srv/app/.git/voktty-worktrees/voktty-feature-123",
      true,
    );

    expect(mocks.invoke).toHaveBeenCalledWith(
      "git_worktrees",
      expect.objectContaining({ cwd: "/srv/app" }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "git_worktree_check_remove",
      expect.anything(),
    );
  });

  it("requires remote worktree status even when forced removal is selected", async () => {
    mocks.invoke.mockResolvedValueOnce({
      worktrees: [
        { ...tree, path: "/srv/app", isMain: true },
        { ...tree, dirty: null },
      ],
      defaultRoot: "/srv/app/.git/voktty-worktrees",
    });

    await expect(
      checkWorktreeRemoval(
        "remote://machine-1/srv/app",
        "remote://machine-1/srv/app/.git/voktty-worktrees/voktty-feature-123",
        true,
      ),
    ).rejects.toThrow("Worktree status is unavailable.");
  });

  it("rejects a worktree path from another remote profile before connecting", async () => {
    await expect(
      removeWorktree(
        "remote://voktty-ssh-profile-1/srv/app",
        "remote://voktty-ssh-profile-2/srv/other/.git/voktty-worktrees/tree",
        true,
      ),
    ).rejects.toThrow("Worktrees must belong to the selected remote project.");

    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects remote worktree access outside a saved project", async () => {
    mocks.remoteProjectForPath.mockReturnValueOnce(undefined);

    await expect(
      listWorktrees("remote://voktty-ssh-profile-1/srv/other"),
    ).rejects.toThrow("outside a saved remote project");

    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
