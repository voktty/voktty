import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";
import { remoteSessions } from "@/modules/remote/sessionManager";
import { useHarnessProjectEnvStore } from "@/modules/harness/lib/harnessEnvStore";
import { remoteSshConnectionForProfile } from "@/modules/connections/model/remoteSshProfiles";
import { RemoteSessionConnectionChangedError } from "@/modules/remote/sessionPool";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import type { SshConnection } from "@/modules/ssh/types";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  project: vi.fn(),
  profiles: [] as SshConnection[],
}));
vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: mocks.open,
  closeRemoteWorkspace: mocks.close,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ sshConnections: mocks.profiles }) },
}));
vi.mock("@/modules/connections/model/remoteProjects", async (original) => ({
  ...(await original<
    typeof import("@/modules/connections/model/remoteProjects")
  >()),
  remoteProjectForPath: mocks.project,
}));
const profile: SshConnection = {
  id: "build",
  name: "Build",
  host: "build.example",
  user: "dev",
  port: 2222,
  identityFile: "/keys/build",
  multiplexerMode: "none",
};
const project = "remote://voktty-ssh-build/srv/app";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles = [{ ...profile }];
  mocks.project.mockReturnValue({
    environmentId: "voktty-ssh-build",
    cwd: "/srv/app",
  });
  mocks.open.mockResolvedValue({
    session_id: 71,
    workspace_root: "/srv/app",
    architecture: "x86_64",
    helper_version: "test",
    capabilities: [],
  });
  mocks.close.mockResolvedValue(undefined);
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
});
afterEach(async () => {
  await useHarnessProjectEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
});

it("acquires an independent saved-profile lease instead of borrowing ambient native identity", async () => {
  useWorkspaceEnvStore.setState({
    env: { kind: "ssh", connection: profile, root: "/srv/app", sessionId: 42 },
  });
  const target = await openProjectTerminalTarget(`${project}/src`);
  expect(target?.cwd).toBe("/srv/app/src");
  expect(target?.workspace).toMatchObject({
    root: "/srv/app",
    sessionId: 71,
    connection: profile,
  });
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
    remoteSshConnectionForProfile(profile),
    "/srv/app",
  );
  await target?.lease.releaseAndClose?.();
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(71);
});

it("releases only its lease while a project and another reader retain the real pooled helper", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile, "/srv/app", project);
  const other = await remoteSessions.acquire(
    { profileId: profile.id, root: "/srv/app" },
    remoteSshConnectionForProfile(profile),
  );
  const target = await openProjectTerminalTarget(`${project}/src`);
  expect(remoteSessions.snapshot()[0]?.leases).toBe(3);
  await target?.lease.releaseAndClose?.();
  expect(remoteSessions.snapshot()[0]?.leases).toBe(2);
  expect(mocks.close).not.toHaveBeenCalled();
  await useHarnessProjectEnvStore.getState().disconnect(project);
  expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
  other.release();
});

it("preserves the target lease after its project owner disconnects", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile, "/srv/app", project);
  const target = await openProjectTerminalTarget(project);
  await useHarnessProjectEnvStore.getState().disconnect(project);
  expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
  expect(mocks.close).not.toHaveBeenCalled();
  await target?.lease.releaseAndClose?.();
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(71);
});

it.each(["voktty-ssh-build", "build.example"])(
  "uses only exact owned configuration for an unsaved profile (%s)",
  async (environmentId) => {
    const owned = `remote://${environmentId}/srv/app`;
    mocks.project.mockReturnValue({ environmentId, cwd: "/srv/app" });
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", owned);
    mocks.profiles = [];
    const target = await openProjectTerminalTarget(`${owned}/src`);
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(2);
    expect(target?.workspace).toMatchObject({
      sessionId: 71,
      connection: profile,
    });
    await target?.lease.releaseAndClose?.();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
  },
);

it("prefers changed saved configuration and rejects reuse of an old authenticated binding", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile, "/srv/app", project);
  mocks.profiles = [{ ...profile, host: "changed.example" }];
  await expect(openProjectTerminalTarget(project)).rejects.toBeInstanceOf(
    RemoteSessionConnectionChangedError,
  );
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
  expect(mocks.close).not.toHaveBeenCalled();
});

it("refuses an ownerless pool entry and an ambient connection when the saved profile is missing", async () => {
  mocks.profiles = [];
  useWorkspaceEnvStore.setState({
    env: { kind: "ssh", connection: profile, root: "/srv/app", sessionId: 42 },
  });
  const borrowed = await remoteSessions.acquire(
    { profileId: profile.id, root: "/srv/app" },
    remoteSshConnectionForProfile(profile),
  );
  await expect(openProjectTerminalTarget(project)).rejects.toThrow(
    "saved SSH connection for this project is missing",
  );
  expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  borrowed.release();
});

it.each(["actual-root", "ancestor", "profile", "namespace"])(
  "rejects a mismatched owned %s instead of falling back locally",
  async (kind) => {
    const ownedProfile =
      kind === "profile" ? { ...profile, id: "other" } : profile;
    const root = kind === "ancestor" ? "/srv" : "/srv/app";
    const owned =
      kind === "ancestor" ? "remote://voktty-ssh-build/srv" : project;
    const actual = kind === "actual-root" ? "/srv/other" : root;
    mocks.open.mockResolvedValueOnce({
      session_id: 71,
      workspace_root: actual,
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    });
    await useHarnessProjectEnvStore
      .getState()
      .connect(ownedProfile, root, owned);
    mocks.profiles = [];
    const target = kind === "namespace" ? "remote://unknown/srv/app" : project;
    if (kind === "namespace")
      mocks.project.mockReturnValue({
        environmentId: "unknown",
        cwd: "/srv/app",
      });
    await expect(openProjectTerminalTarget(target)).rejects.toThrow(
      "saved SSH connection for this project is missing",
    );
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.close).not.toHaveBeenCalled();
  },
);

it("rejects a conflicting project namespace before native allocation", async () => {
  mocks.project.mockReturnValue({ environmentId: "other", cwd: "/srv/app" });
  await expect(openProjectTerminalTarget(project)).rejects.toThrow(
    "outside a saved project",
  );
  expect(mocks.open).not.toHaveBeenCalled();
});

it("rejects malformed namespaces and missing profiles without a native fallback", async () => {
  await expect(
    openProjectTerminalTarget("remote://voktty-ssh-build"),
  ).rejects.toThrow("path is invalid");
  mocks.profiles = [];
  await expect(openProjectTerminalTarget(project)).rejects.toThrow(
    "saved SSH connection for this project is missing",
  );
  expect(mocks.open).not.toHaveBeenCalled();
});

it("resolves ad-hoc and legacy SSH namespaces while rejecting unknown transports", async () => {
  mocks.project.mockReturnValue(undefined);
  const target = await openProjectTerminalTarget(
    "remote://voktty-ssh-build/work/app",
  );
  expect(mocks.open).toHaveBeenCalledWith(
    remoteSshConnectionForProfile(profile),
    "/work/app",
  );
  expect(target?.cwd).toBe("/work/app");
  await target?.lease.releaseAndClose?.();
  const legacy = await openProjectTerminalTarget(
    "remote://build.example/srv/app",
  );
  expect(legacy?.workspace.connection.id).toBe(profile.id);
  await legacy?.lease.releaseAndClose?.();
  await expect(
    openProjectTerminalTarget("remote://unknown/srv/app"),
  ).rejects.toThrow("saved SSH connection for this project is missing");
  expect(mocks.open).toHaveBeenCalledTimes(2);
});
