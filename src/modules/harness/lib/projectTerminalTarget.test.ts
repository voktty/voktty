import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
import type { SshConnection } from "@/modules/ssh/types";
import { openProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  probe: vi.fn(),
  profiles: [] as SshConnection[],
  project: { environmentId: "voktty-ssh-build", cwd: "/srv/app" },
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: mocks.acquire },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ sshConnections: mocks.profiles }) },
}));
vi.mock("@/modules/ssh/types", () => ({ probeSshMultiplexer: mocks.probe }));
vi.mock("@/modules/harness/lib/harnessEnvStore", () => ({
  useHarnessProjectEnvStore: { getState: () => ({ projects: {} }) },
  harnessProjectEnvironmentFor: () => ({ env: { kind: "local" } }),
}));
vi.mock(
  "@/modules/connections/model/remoteProjects",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/modules/connections/model/remoteProjects")
    >()),
    remoteProjectForPath: () => mocks.project,
  }),
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const cwd = "remote://voktty-ssh-build/srv/app/src";
const probe = { supported: true, sessions: [] };
let profile: SshConnection;
let lease: RemoteSessionLease;

beforeEach(() => {
  vi.clearAllMocks();
  profile = {
    id: "build",
    name: "Build",
    host: "build.example",
    user: "dev",
    port: 2222,
    identityFile: "/keys/build",
    multiplexerMode: "ask",
  };
  mocks.profiles = [profile];
  mocks.project = { environmentId: "voktty-ssh-build", cwd: "/srv/app" };
  lease = {
    info: {
      session_id: 71,
      workspace_root: "/srv/app",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    },
    release: vi.fn(),
  };
  mocks.acquire.mockResolvedValue(lease);
  mocks.probe.mockResolvedValue(probe);
});

describe("project terminal target", () => {
  it("does not enter connection work for a retired request", async () => {
    expect(
      await openProjectTerminalTarget(cwd, undefined, () => false),
    ).toBeUndefined();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("does not acquire a helper after retirement during an unavailable probe", async () => {
    let current = true;
    const pending = deferred<typeof probe>();
    mocks.probe.mockReturnValueOnce(pending.promise);
    const picker = vi.fn();
    const opening = openProjectTerminalTarget(cwd, picker, () => current);
    current = false;
    pending.resolve({ supported: false, sessions: [] });
    expect(await opening).toBeUndefined();
    expect(picker).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it("returns its own lease and resolved host path without releasing ownership", async () => {
    const target = await openProjectTerminalTarget(cwd);
    expect(target).toEqual({
      cwd: "/srv/app/src",
      workspace: {
        kind: "ssh",
        connection: profile,
        root: "/srv/app",
        sessionId: 71,
      },
      lease,
    });
    expect(mocks.acquire).toHaveBeenCalledWith(
      { profileId: "build", root: "/srv/app" },
      {
        host: "build.example",
        user: "dev",
        port: 2222,
        identityFile: "/keys/build",
      },
    );
    expect(lease.release).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("captures profile and project before a pending multiplexer probe", async () => {
    const pending = deferred<typeof probe>();
    mocks.probe.mockReturnValueOnce(pending.promise);
    const picker = vi
      .fn()
      .mockResolvedValue({ action: "attach", sessionName: "work" });
    const opening = openProjectTerminalTarget(cwd, picker);
    profile.id = "replacement";
    profile.host = "other.example";
    profile.multiplexerMode = "none";
    mocks.project.cwd = "/srv/other";
    pending.resolve(probe);
    const target = await opening;
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "build",
        host: "build.example",
        multiplexerMode: "ask",
      }),
      probe,
    );
    expect(mocks.acquire).toHaveBeenCalledWith(
      { profileId: "build", root: "/srv/app" },
      expect.objectContaining({ host: "build.example" }),
    );
    expect(target?.workspace.connection).toMatchObject({
      id: "build",
      host: "build.example",
      multiplexerMode: "ask",
      activeMultiplexerSession: "work",
    });
  });

  it("does not let probe or picker callbacks change the authenticated connection", async () => {
    mocks.probe.mockImplementationOnce(async (connection: SshConnection) => {
      connection.host = "probe.example";
      return probe;
    });
    const target = await openProjectTerminalTarget(cwd, async (connection) => {
      connection.id = "picker";
      connection.host = "picker.example";
      connection.multiplexerMode = "none";
      return { action: "attach_force", sessionName: "work" };
    });
    expect(mocks.acquire).toHaveBeenCalledWith(
      { profileId: "build", root: "/srv/app" },
      expect.objectContaining({ host: "build.example" }),
    );
    expect(target?.workspace.connection).toMatchObject({
      id: "build",
      host: "build.example",
      multiplexerMode: "ask",
      multiplexerAction: "attach_force",
    });
    expect(profile.host).toBe("build.example");
  });

  it("keeps the captured profile while its lease is opening", async () => {
    const pending = deferred<RemoteSessionLease>();
    mocks.acquire.mockReturnValueOnce(pending.promise);
    const opening = openProjectTerminalTarget(cwd);
    profile.host = "replacement.example";
    profile.port = 22;
    pending.resolve(lease);
    expect((await opening)?.workspace.connection).toMatchObject({
      host: "build.example",
      port: 2222,
    });
  });

  it("cancels before acquiring a lease when the picker declines", async () => {
    await expect(
      openProjectTerminalTarget(cwd, async () => null),
    ).rejects.toThrow("connection was canceled");
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("keeps the original connection when probing is unavailable", async () => {
    mocks.probe.mockRejectedValueOnce(new Error("probe unavailable"));
    const picker = vi.fn();
    const target = await openProjectTerminalTarget(cwd, picker);
    expect(target?.workspace.connection.host).toBe("build.example");
    expect(picker).not.toHaveBeenCalled();
  });

  it.each(["/srv/app", "C:/work/app", "//server/share/app"])(
    "leaves native folders to the caller (%s)",
    async (path) => {
      expect(await openProjectTerminalTarget(path)).toBeUndefined();
      expect(mocks.acquire).not.toHaveBeenCalled();
    },
  );
});
