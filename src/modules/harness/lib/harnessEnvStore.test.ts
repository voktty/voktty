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
