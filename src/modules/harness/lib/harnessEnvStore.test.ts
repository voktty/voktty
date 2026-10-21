import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openRemoteWorkspace: vi.fn(),
  closeRemoteWorkspace: vi.fn(),
}));

vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: mocks.openRemoteWorkspace,
  closeRemoteWorkspace: mocks.closeRemoteWorkspace,
}));
vi.mock("@/modules/connections/model/remoteSshProfiles", () => ({
  remoteSshEnvironmentId: (id: string) =>
    `voktty-ssh-${encodeURIComponent(id)}`,
  remoteSshConnectionForProfile: (profile: { host: string }) => ({
    host: profile.host,
    port: 22,
  }),
}));

import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  harnessProjectEnvironmentId,
  harnessProjectEnvironmentFor,
  useHarnessEnvStore,
  useHarnessProjectEnvStore,
} from "./harnessEnvStore";

import { MAX_PROJECT_ENVIRONMENT_OWNERS } from "./projectEnvironmentRegistry";

const profile = { id: "p1", name: "prod", host: "example.test" };
const info = (id: number, root = "/srv/app") => ({
  session_id: id,
  architecture: "x86_64",
  workspace_root: root,
  helper_version: "1",
  capabilities: [],
});

beforeEach(async () => {
  await useHarnessEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
  useHarnessEnvStore.setState({
    env: { kind: "local" },
    connecting: false,
    error: null,
  });
  mocks.openRemoteWorkspace.mockReset().mockResolvedValue(info(5));
  mocks.closeRemoteWorkspace.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await useHarnessEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
});

it("shares its session with file commands of the same profile and root", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, "/srv/app");
  const used = await remoteSessions.use(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
    async (session) => session.session_id,
  );
  expect(used).toBe(5);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
});

it("keeps the session open while connected and closes it on disconnect", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, "/srv/app");
  await remoteSessions.use(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
    async () => undefined,
  );
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  await useHarnessEnvStore.getState().disconnect();
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(5);
  expect(useHarnessEnvStore.getState().env).toEqual({ kind: "local" });
});

it("falls back to the default root when the requested one cannot be opened", async () => {
  mocks.openRemoteWorkspace
    .mockRejectedValueOnce(new Error("no such directory"))
    .mockResolvedValueOnce(info(6));
  const env = await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/missing");
  expect(env).toMatchObject({ kind: "ssh", sessionId: 6 });
  expect(mocks.openRemoteWorkspace).toHaveBeenLastCalledWith(
    expect.anything(),
    ".",
  );
});

it("reports a failed connection without leaving a half-open environment", async () => {
  mocks.openRemoteWorkspace.mockRejectedValue(new Error("auth failed"));
  await expect(
    useHarnessEnvStore.getState().connect(profile as never, "/srv/app"),
  ).rejects.toThrow("auth failed");
  expect(useHarnessEnvStore.getState()).toMatchObject({
    env: { kind: "local" },
    connecting: false,
    error: "auth failed",
  });
});
it("closes a session set from outside the pool when disconnecting", async () => {
  useHarnessEnvStore.getState().setEnv({
    kind: "ssh",
    connection: profile as never,
    root: "/srv/app",
    sessionId: 42,
  });
  await useHarnessEnvStore.getState().disconnect();
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(42);
});

it("retains both remote projects and closes only the requested one", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(10, "/a"))
    .mockResolvedValueOnce(info(20, "/b"));
  await useHarnessEnvStore.getState().connect(profile as never, "/a");
  await useHarnessEnvStore.getState().connect(profile as never, "/b");
  const first = harnessProjectEnvironmentId("p1", "/a");
  const second = harnessProjectEnvironmentId("p1", "/b");
  expect(
    Object.keys(useHarnessProjectEnvStore.getState().projects),
  ).toHaveLength(2);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  await useHarnessEnvStore.getState().disconnect(first);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(10);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(20);
  expect(useHarnessEnvStore.getState().env).toMatchObject({
    kind: "ssh",
    sessionId: 20,
  });
  expect(useHarnessProjectEnvStore.getState().projects[first]).toBeUndefined();
  expect(
    useHarnessProjectEnvStore.getState().projects[second].env,
  ).toMatchObject({ sessionId: 20 });
});

it("preserves a new selection created synchronously during another project's release", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(10, "/a"))
    .mockResolvedValueOnce(info(20, "/b"));
  await useHarnessEnvStore.getState().connect(profile as never, "/a");
  const first = harnessProjectEnvironmentId("p1", "/a");
  let connecting: Promise<unknown> | undefined;
  const unsubscribe = useHarnessProjectEnvStore.subscribe((state) => {
    if (!connecting && state.projectId === first && !state.projects[first]) {
      connecting = state.connect(
        { ...profile, id: "p2", host: "other.test" } as never,
        "/b",
      );
    }
  });
  try {
    await useHarnessEnvStore.getState().disconnect(first);
    await connecting;
    expect(useHarnessEnvStore.getState().env).toMatchObject({
      connection: { id: "p2" },
      sessionId: 20,
    });
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(20);
  } finally {
    unsubscribe();
  }
});

it("shares an admitted promise with a same-project reentrant connect", async () => {
  const projectId = harnessProjectEnvironmentId("p1", "/srv/app");
  let duplicate: Promise<unknown> | undefined;
  let requested = false;
  const unsubscribe = useHarnessProjectEnvStore.subscribe((state) => {
    if (!requested && state.projectId === projectId && state.connecting) {
      requested = true;
      duplicate = state.connect(profile as never, "/srv/app");
    }
  });
  try {
    const env = await useHarnessEnvStore
      .getState()
      .connect(profile as never, "/srv/app");
    expect(duplicate).toBeDefined();
    expect(await duplicate).toEqual(env);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(remoteSessions.snapshot()[0].leases).toBe(1);
  } finally {
    unsubscribe();
  }
});

it("selects a local surface without releasing a remote project", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, "/srv/app");
  const projectId = useHarnessEnvStore.getState().projectId;
  useHarnessProjectEnvStore.getState().selectProject(null);
  expect(useHarnessEnvStore.getState().env).toEqual({ kind: "local" });
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  useHarnessProjectEnvStore.getState().selectProject(projectId);
  expect(useHarnessEnvStore.getState().env).toMatchObject({
    kind: "ssh",
    sessionId: 5,
  });
});

it("does not close the just-acquired session when connecting twice to the same project", async () => {
  const first = await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  const second = await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  expect(second).toEqual(first);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  expect(remoteSessions.snapshot()[0].leases).toBe(1);
});

it("reconnects a shared root without releasing another consumer's lease", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, "/srv/app");
  const other = await remoteSessions.acquire(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
  );
  try {
    await useHarnessEnvStore.getState().reconnect(profile as never, "/srv/app");
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0].leases).toBe(2);
    await useHarnessEnvStore.getState().disconnect();
    expect(remoteSessions.snapshot()[0].leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  } finally {
    other.release();
  }
});

it("does not replace the latest selection when an older project connects late", async () => {
  let finish!: (value: ReturnType<typeof info>) => void;
  mocks.openRemoteWorkspace
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(info(20, "/b"));
  const first = useHarnessEnvStore.getState().connect(profile as never, "/a");
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await useHarnessEnvStore.getState().connect(profile as never, "/b");
  finish(info(10, "/a"));
  await first;
  expect(useHarnessEnvStore.getState().env).toMatchObject({ sessionId: 20 });
  expect(
    Object.keys(useHarnessProjectEnvStore.getState().projects),
  ).toHaveLength(2);
});

it("never falls back or resurrects a project after disconnect during connect", async () => {
  let finish!: (value: ReturnType<typeof info>) => void;
  mocks.openRemoteWorkspace.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const connecting = useHarnessEnvStore
    .getState()
    .connect(profile as never, "/pending");
  const rejected = expect(connecting).rejects.toThrow("cancelled");
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await useHarnessEnvStore.getState().disconnect();
  finish(info(12, "/pending"));
  await rejected;
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(12);
  expect(useHarnessProjectEnvStore.getState().projects).toEqual({});
  expect(useHarnessEnvStore.getState().env).toEqual({ kind: "local" });
});

it("cleans a profile's background projects while preserving another selected profile", async () => {
  const otherProfile = { ...profile, id: "p2", host: "other.test" };
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(10, "/a"))
    .mockResolvedValueOnce(info(20, "/b"));
  await useHarnessEnvStore.getState().connect(profile as never, "/a");
  await useHarnessEnvStore.getState().connect(otherProfile as never, "/b");
  await useHarnessEnvStore.getState().disconnectProfiles(new Set(["p1"]));
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(10);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(20);
  expect(useHarnessEnvStore.getState().env).toMatchObject({
    connection: { id: "p2" },
    sessionId: 20,
  });
});

it("recovers a cached project lease after the pool invalidates its session", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, "/srv/app");
  mocks.openRemoteWorkspace.mockResolvedValueOnce(info(6));
  remoteSessions.invalidate({ profileId: "p1", root: "/srv/app" }, 5);
  const recovered = await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  expect(recovered).toMatchObject({ sessionId: 6 });
  expect(useHarnessEnvStore.getState().env).toMatchObject({ sessionId: 6 });
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(2);
});

it("keeps an admitted connection valid when a force replacement exceeds capacity", async () => {
  const finishes: Array<(value: ReturnType<typeof info>) => void> = [];
  mocks.openRemoteWorkspace.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  const connections = Array.from(
    { length: MAX_PROJECT_ENVIRONMENT_OWNERS },
    (_, index) =>
      useHarnessEnvStore
        .getState()
        .connect(
          { ...profile, id: `capacity-${index}` } as never,
          ".",
          `capacity-project-${index}`,
        ),
  );
  const completed = Promise.all(connections);
  const selectedBefore = useHarnessEnvStore.getState().projectId;
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  expect(finishes).toHaveLength(MAX_PROJECT_ENVIRONMENT_OWNERS);
  const forceRequests = Array.from({ length: 2 }, () =>
    useHarnessEnvStore
      .getState()
      .reconnect(
        { ...profile, id: "capacity-0" } as never,
        ".",
        "capacity-project-0",
      ),
  );
  await Promise.all(
    forceRequests.map(async (request) => {
      await expect(request).rejects.toThrow(
        "Too many project environment owners.",
      );
    }),
  );
  finishes.forEach((finish, index) => {
    finish(info(1000 + index, "/actual"));
  });
  const environments = await completed;
  expect(environments[0]).toMatchObject({ sessionId: 1000 });
  expect(useHarnessEnvStore.getState().projectId).toBe(selectedBefore);
  expect(useHarnessEnvStore.getState().env).toMatchObject({
    sessionId: 1000 + MAX_PROJECT_ENVIRONMENT_OWNERS - 1,
  });
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(
    MAX_PROJECT_ENVIRONMENT_OWNERS,
  );
});

it("never closes a borrowed pooled id supplied through the legacy setter", async () => {
  const other = await remoteSessions.acquire(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
  );
  try {
    useHarnessEnvStore.getState().setEnv({
      kind: "ssh",
      connection: profile as never,
      root: "/srv/app",
      sessionId: 5,
    });
    await useHarnessEnvStore.getState().disconnect();
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0].leases).toBe(1);
  } finally {
    other.release();
  }
});

it.each(["C:\\Work\\App", "\\\\server\\share\\App"])(
  "preserves a Windows remote root: %s",
  async (root) => {
    mocks.openRemoteWorkspace.mockResolvedValue(info(5, root));
    await useHarnessEnvStore.getState().connect(profile as never, root);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      root,
    );
    expect(useHarnessEnvStore.getState().env).toMatchObject({
      kind: "ssh",
      root,
    });
    expect(useHarnessEnvStore.getState().projectId).toBe(
      harnessProjectEnvironmentId("p1", root),
    );
  },
);

it("returns a rejected promise for malformed input rather than throwing into an effect", async () => {
  let connecting!: Promise<unknown>;
  expect(() => {
    connecting = useHarnessEnvStore
      .getState()
      .connect(profile as never, 42 as never);
  }).not.toThrow();
  await expect(connecting).rejects.toBeInstanceOf(TypeError);
  expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
});

it("reads, selects and closes the actual root of a default-root owner", async () => {
  const owner = harnessProjectEnvironmentId("p1", ".");
  const actual = harnessProjectEnvironmentId("p1", "/real");
  mocks.openRemoteWorkspace.mockResolvedValue(info(5, "/real"));
  await useHarnessEnvStore.getState().connect(profile as never, ".");
  expect(
    harnessProjectEnvironmentFor(actual, useHarnessEnvStore.getState().projects)
      .env,
  ).toMatchObject({ sessionId: 5, root: "/real" });
  useHarnessEnvStore.getState().selectProject(actual);
  expect(useHarnessEnvStore.getState().projectId).toBe(owner);
  await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/real", actual);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(remoteSessions.snapshot()[0].leases).toBe(1);
  await useHarnessEnvStore.getState().disconnect(actual);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(5);
  expect(useHarnessEnvStore.getState().projects).toEqual({});
});

it("reuses and closes a fallback owner through its confirmed actual root", async () => {
  mocks.openRemoteWorkspace
    .mockRejectedValueOnce(new Error("missing"))
    .mockResolvedValueOnce(info(6, "/real"));
  await useHarnessEnvStore.getState().connect(profile as never, "/missing");
  const actual = harnessProjectEnvironmentId("p1", "/real");
  await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/real", actual);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(2);
  expect(useHarnessEnvStore.getState().projectId).toBe(
    harnessProjectEnvironmentId("p1", "/missing"),
  );
  await useHarnessEnvStore.getState().disconnect(actual);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(6);
});

it("reconnects a default-root alias at its actual root, not a changed login home", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(5, "/real"))
    .mockResolvedValueOnce(info(6, "/real"));
  await useHarnessEnvStore.getState().connect(profile as never, ".");
  const actual = harnessProjectEnvironmentId("p1", "/real");
  await useHarnessEnvStore
    .getState()
    .reconnect(profile as never, "/real", actual);
  expect(mocks.openRemoteWorkspace).toHaveBeenLastCalledWith(
    expect.anything(),
    "/real",
  );
  expect(Object.keys(useHarnessEnvStore.getState().projects)).toHaveLength(1);
  expect(
    harnessProjectEnvironmentFor(actual, useHarnessEnvStore.getState().projects)
      .env,
  ).toMatchObject({ sessionId: 6 });
});

it("keeps a known project alias addressable while its reconnect fails", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, ".");
  mocks.openRemoteWorkspace.mockRejectedValue(new Error("auth failed"));
  const actual = harnessProjectEnvironmentId("p1", "/srv/app");
  await expect(
    useHarnessEnvStore
      .getState()
      .reconnect(profile as never, "/srv/app", actual),
  ).rejects.toThrow("auth failed");
  expect(
    harnessProjectEnvironmentFor(
      actual,
      useHarnessEnvStore.getState().projects,
    ),
  ).toMatchObject({
    env: { kind: "local" },
    connecting: false,
    error: "auth failed",
  });
  await useHarnessEnvStore.getState().disconnect(actual);
  expect(useHarnessEnvStore.getState().projects).toEqual({});
});

it("closes automatic aliases together without closing an explicit same-root owner", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(5, "/real"))
    .mockResolvedValueOnce(info(6, "/real"));
  const actual = harnessProjectEnvironmentId("p1", "/real");
  await Promise.all([
    useHarnessEnvStore.getState().connect(profile as never, "."),
    useHarnessEnvStore.getState().connect(profile as never, "/real", actual),
  ]);
  await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/real", "alpha");
  await useHarnessEnvStore.getState().disconnect(actual);
  expect(Object.keys(useHarnessEnvStore.getState().projects)).toEqual([
    "alpha",
  ]);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(5);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(6);
  expect(
    remoteSessions.snapshot().find((entry) => entry.sessionId === 6)?.leases,
  ).toBe(1);
  expect(useHarnessEnvStore.getState().env).toMatchObject({ sessionId: 6 });
});

it("preserves a same-key reconnect created during atomic alias release", async () => {
  const actual = harnessProjectEnvironmentId("p1", "/real");
  const defaultId = harnessProjectEnvironmentId("p1", ".");
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(5, "/real"))
    .mockResolvedValueOnce(info(6, "/real"));
  await Promise.all([
    useHarnessEnvStore.getState().connect(profile as never, "."),
    useHarnessEnvStore.getState().connect(profile as never, "/real", actual),
  ]);
  await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/real", "alpha");
  useHarnessEnvStore.getState().selectProject(actual);
  let requested = false;
  let reconnected: Promise<unknown> | undefined;
  const unsubscribe = useHarnessEnvStore.subscribe((state) => {
    if (!requested && !state.projects[defaultId] && !state.projects[actual]) {
      requested = true;
      reconnected = state.connect(profile as never, "/real", actual);
    }
  });
  try {
    await useHarnessEnvStore.getState().disconnect(actual);
    expect(reconnected).toBeDefined();
    await reconnected;
    expect(useHarnessEnvStore.getState().projectId).toBe(actual);
    expect(useHarnessEnvStore.getState().projects[actual].env).toMatchObject({
      sessionId: 6,
    });
    expect(
      remoteSessions.snapshot().find((entry) => entry.sessionId === 6)?.leases,
    ).toBe(2);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(6);
  } finally {
    unsubscribe();
  }
});

it("never reads another profile or local project through the selected facade", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, ".");
  const projects = useHarnessEnvStore.getState().projects;
  expect(
    harnessProjectEnvironmentFor(
      harnessProjectEnvironmentId("p2", "/srv/app"),
      projects,
    ).env,
  ).toEqual({ kind: "local" });
  expect(harnessProjectEnvironmentFor("/local", projects)).toBe(
    harnessProjectEnvironmentFor(null, projects),
  );
});

it("does not reuse a default-root alias after its saved host changes", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(5, "/real"))
    .mockResolvedValueOnce(info(6, "/real"));
  await useHarnessEnvStore.getState().connect(profile as never, ".");
  await useHarnessEnvStore
    .getState()
    .connect({ ...profile, host: "other.test" } as never, "/real");
  expect(mocks.openRemoteWorkspace).toHaveBeenLastCalledWith(
    { host: "other.test", port: 22 },
    "/real",
  );
  expect(useHarnessEnvStore.getState().env).toMatchObject({
    sessionId: 6,
    connection: { host: "other.test" },
  });
});

it("opens a fresh same-root session when the saved connection configuration changes", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, "/srv/app");
  mocks.openRemoteWorkspace.mockResolvedValueOnce(info(6));
  const env = await useHarnessEnvStore
    .getState()
    .connect({ ...profile, host: "other.test" } as never, "/srv/app");
  expect(env).toMatchObject({
    sessionId: 6,
    connection: { host: "other.test" },
  });
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(2);
  expect(mocks.openRemoteWorkspace).toHaveBeenLastCalledWith(
    { host: "other.test", port: 22 },
    "/srv/app",
  );
});

it("rejects changed same-root credentials while another holder owns the old session", async () => {
  await useHarnessEnvStore.getState().connect(profile as never, "/srv/app");
  const other = await remoteSessions.acquire(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
  );
  try {
    await expect(
      useHarnessEnvStore
        .getState()
        .connect({ ...profile, host: "other.test" } as never, "/srv/app"),
    ).rejects.toMatchObject({ code: "REMOTE_SESSION_CONNECTION_CHANGED" });
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0].leases).toBe(1);
    expect(useHarnessEnvStore.getState().env).toEqual({ kind: "local" });
  } finally {
    other.release();
  }
});

it("does not deduplicate a mutated caller profile against its pending native attempt", async () => {
  let finish!: (value: ReturnType<typeof info>) => void;
  mocks.openRemoteWorkspace.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const mutable = { ...profile };
  const first = useHarnessEnvStore
    .getState()
    .connect(mutable as never, "/srv/app");
  const cancelled = expect(first).rejects.toThrow("cancelled");
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  mutable.host = "other.test";
  await expect(
    useHarnessEnvStore.getState().connect(mutable as never, "/srv/app"),
  ).rejects.toMatchObject({ code: "REMOTE_SESSION_CONNECTION_CHANGED" });
  finish(info(5));
  await cancelled;
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(5);
});

it("does not retry the default root while the original helper cleanup is retained", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(10, "/original"))
    .mockResolvedValueOnce(info(20, "/busy"))
    .mockResolvedValue(info(30, "/fallback"));
  const original = await remoteSessions.acquire(
    { profileId: profile.id, root: "/original" },
    { host: profile.host, port: 22 },
  );
  const busyProfile = { ...profile, id: "busy-profile", host: "busy.test" };
  await useHarnessEnvStore.getState().connect(busyProfile as never, "/busy");
  const busyId = harnessProjectEnvironmentId(busyProfile.id, "/busy");
  const busyBefore = useHarnessEnvStore.getState().projects[busyId];
  const busyPoolBefore = remoteSessions
    .snapshot()
    .find((entry) => entry.sessionId === 20);
  mocks.closeRemoteWorkspace.mockImplementation((id: number) =>
    id === 10
      ? Promise.reject(new Error("native cleanup pending"))
      : Promise.resolve(),
  );
  try {
    if (!original.releaseAndClose)
      throw new Error("Expected exact lease cleanup.");
    await expect(original.releaseAndClose()).rejects.toThrow(
      "native cleanup pending",
    );
    expect(
      remoteSessions.snapshot().find((entry) => entry.sessionId === 10),
    ).toMatchObject({ closing: true, leases: 0 });
    await expect(
      useHarnessEnvStore.getState().connect(profile as never, "/original"),
    ).rejects.toMatchObject({
      code: "REMOTE_SESSION_ADMISSION_BLOCKED",
      reason: "cleanup",
    });
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalledWith(
      expect.anything(),
      ".",
    );
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(20);
    expect(
      remoteSessions.snapshot().find((entry) => entry.sessionId === 10),
    ).toMatchObject({ closing: true, leases: 0 });
    expect(
      remoteSessions.snapshot().find((entry) => entry.sessionId === 20),
    ).toEqual(busyPoolBefore);
    expect(useHarnessEnvStore.getState().projects[busyId]).toEqual(busyBefore);
  } finally {
    mocks.closeRemoteWorkspace.mockResolvedValue(undefined);
  }
});

it("does not retry the default root after real helper pool capacity rejection", async () => {
  let nextId = 1000;
  mocks.openRemoteWorkspace.mockImplementation((_connection, root: string) =>
    Promise.resolve(info(nextId++, root)),
  );
  const busyProfile = { ...profile, id: "busy-profile", host: "busy.test" };
  await useHarnessEnvStore.getState().connect(busyProfile as never, "/busy");
  const busyId = harnessProjectEnvironmentId(busyProfile.id, "/busy");
  const busyBefore = useHarnessEnvStore.getState().projects[busyId];
  const leases = await Promise.all(
    Array.from({ length: 255 }, (_, index) =>
      remoteSessions.acquire(
        { profileId: `capacity-${index}`, root: `/slot-${index}` },
        { host: profile.host, port: 22 },
      ),
    ),
  );
  const acquire = vi.spyOn(remoteSessions, "acquire");
  try {
    expect(remoteSessions.snapshot()).toHaveLength(256);
    await expect(
      useHarnessEnvStore.getState().connect(profile as never, "/blocked"),
    ).rejects.toMatchObject({
      code: "REMOTE_SESSION_ADMISSION_BLOCKED",
      reason: "capacity",
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(
      { profileId: profile.id, root: "/blocked" },
      { host: profile.host, port: 22 },
    );
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(256);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(useHarnessEnvStore.getState().projects[busyId]).toEqual(busyBefore);
  } finally {
    acquire.mockRestore();
    for (const lease of leases) lease.release();
  }
});

it.each([
  "Remote session cleanup failed; retry closing it before reconnecting.",
  "Remote session limit reached; close an unused session first.",
])(
  "preserves default-root fallback for ordinary bootstrap errors: %s",
  async (message) => {
    mocks.openRemoteWorkspace
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce(info(6, "/fallback"));
    const env = await useHarnessEnvStore
      .getState()
      .connect(profile as never, "/unavailable");
    expect(env).toMatchObject({ kind: "ssh", sessionId: 6, root: "/fallback" });
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.openRemoteWorkspace).toHaveBeenLastCalledWith(
      expect.anything(),
      ".",
    );
  },
);

it("treats a special project key as data rather than a prototype", async () => {
  await useHarnessEnvStore
    .getState()
    .connect(profile as never, "/srv/app", "__proto__");
  expect(
    Object.getOwnPropertyDescriptor(
      useHarnessProjectEnvStore.getState().projects,
      "__proto__",
    ),
  ).toBeDefined();
  expect(useHarnessEnvStore.getState().env).toMatchObject({
    kind: "ssh",
    sessionId: 5,
  });
});
