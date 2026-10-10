import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorktree, listWorktrees } from "./worktrees";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openRemoteWorkspace: vi.fn(),
  closeRemoteWorkspace: vi.fn(),
  remoteMachineFor: vi.fn(),
  remoteSshConnectionFor: vi.fn(),
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
vi.mock("@/modules/harness/lib/harness/remoteOpenCodeService", () => ({
  remoteSshConnectionFor: mocks.remoteSshConnectionFor,
}));
vi.mock("./fs", () => ({ notifyGitChanged: mocks.notifyGitChanged }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ sshConnections: [] }) },
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
  path: "/srv/app-worktrees/voktty-feature-123",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remoteMachineFor.mockResolvedValue({
    id: "machine-1",
    environmentId: "machine-1",
  });
  mocks.remoteSshConnectionFor.mockReturnValue(connection);
  mocks.openRemoteWorkspace.mockResolvedValue(session);
  mocks.closeRemoteWorkspace.mockResolvedValue(undefined);
});

describe("remote Harness worktrees", () => {
  it("lists through Voktty's native SSH helper and remaps host paths", async () => {
    mocks.invoke.mockResolvedValueOnce({
      worktrees: [{ ...tree, path: "/srv/app" }, tree],
      defaultRoot: "/srv/app-worktrees",
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
    expect(result.defaultRoot).toBe("remote://machine-1/srv/app-worktrees");
    expect(result.worktrees[1].path).toBe(
      "remote://machine-1/srv/app-worktrees/voktty-feature-123",
    );
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
      "remote://machine-1/srv/app-worktrees/voktty-feature-123",
    );
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(session.session_id);
    expect(mocks.notifyGitChanged).toHaveBeenCalledOnce();
  });
});
