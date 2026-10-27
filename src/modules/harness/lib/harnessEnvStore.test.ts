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
  useHarnessProjectEnvStore,
} from "./harnessEnvStore";

import { MAX_PROJECT_ENVIRONMENT_OWNERS } from "./projectEnvironmentRegistry";

const profile = { id: "p1", name: "prod", host: "example.test" };

it.each(["env", "projectId", "connecting", "error", "selectProject"])(
  "does not expose ambient environment authority: %s",
  (key) => expect(useHarnessProjectEnvStore.getState()).not.toHaveProperty(key),
);

it("does not export a selected-environment facade", async () => {
  expect(await import("./harnessEnvStore")).not.toHaveProperty(
    "useHarnessEnvStore",
  );
});
function projectReport(root: string, profileId = profile.id) {
  return harnessProjectEnvironmentFor(
    harnessProjectEnvironmentId(profileId, root),
    useHarnessProjectEnvStore.getState().projects,
  );
}
const info = (id: number, root = "/srv/app") => ({
  session_id: id,
  architecture: "x86_64",
  workspace_root: root,
  helper_version: "1",
  capabilities: [],
});

beforeEach(async () => {
  await useHarnessProjectEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
  mocks.openRemoteWorkspace.mockReset().mockResolvedValue(info(5));
  mocks.closeRemoteWorkspace.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await useHarnessProjectEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
});

it("shares its session with file commands of the same profile and root", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  const used = await remoteSessions.use(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
    async (session) => session.session_id,
  );
  expect(used).toBe(5);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
});

it("keeps the session open while connected and closes it on disconnect", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  await remoteSessions.use(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
    async () => undefined,
  );
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  await useHarnessProjectEnvStore
    .getState()
    .disconnect(harnessProjectEnvironmentId("p1", "/srv/app"));
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(5);
  expect(projectReport("/srv/app").env).toEqual({ kind: "local" });
});

it("falls back to the default root when the requested one cannot be opened", async () => {
  mocks.openRemoteWorkspace
    .mockRejectedValueOnce(new Error("no such directory"))
    .mockResolvedValueOnce(info(6));
  const env = await useHarnessProjectEnvStore
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
    useHarnessProjectEnvStore.getState().connect(profile as never, "/srv/app"),
  ).rejects.toThrow("auth failed");
  expect(projectReport("/srv/app")).toMatchObject({
    env: { kind: "local" },
    connecting: false,
    error: "auth failed",
  });
});
it("cannot close an unowned native session through a project disconnect", async () => {
  mocks.openRemoteWorkspace.mockResolvedValueOnce(info(42));
  const borrowed = await remoteSessions.acquire(
    { profileId: profile.id, root: "/srv/app" },
    { host: profile.host, port: 22 },
  );
  try {
    await useHarnessProjectEnvStore
      .getState()
      .disconnect(harnessProjectEnvironmentId("p1", "/srv/app"));
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()).toEqual([
      expect.objectContaining({ sessionId: 42, leases: 1 }),
    ]);
  } finally {
    borrowed.release();
  }
});

it.each([undefined, null, 42, "", " ", "a".repeat(65537)])(
  "rejects an invalid disconnect target without touching live projects (%#)",
  async (target) => {
    mocks.openRemoteWorkspace
      .mockResolvedValueOnce(info(10, "/a"))
      .mockResolvedValueOnce(info(20, "/b"));
    await useHarnessProjectEnvStore.getState().connect(profile as never, "/a");
    await useHarnessProjectEnvStore.getState().connect(profile as never, "/b");
    const projects = useHarnessProjectEnvStore.getState().projects;
    const pool = remoteSessions.snapshot();
    await expect(
      useHarnessProjectEnvStore.getState().disconnect(target as never),
    ).rejects.toThrow("The project identity is invalid.");
    expect(useHarnessProjectEnvStore.getState().projects).toEqual(projects);
    expect(remoteSessions.snapshot()).toEqual(pool);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  },
);

it.each(["profile", "all"])(
  "limits %s cleanup to registered project owners",
  async (scope) => {
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile as never, "/srv/app");
    mocks.openRemoteWorkspace.mockResolvedValueOnce(info(7, "/borrowed"));
    const borrowed = await remoteSessions.acquire(
      { profileId: "other", root: "/borrowed" },
      { host: "other.test", port: 22 },
    );
    try {
      if (scope === "profile")
        await useHarnessProjectEnvStore
          .getState()
          .disconnectProfiles(new Set([profile.id]));
      else await useHarnessProjectEnvStore.getState().disconnectAll();
      expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(5);
      expect(remoteSessions.snapshot()).toEqual([
        expect.objectContaining({ sessionId: 7, leases: 1 }),
      ]);
    } finally {
      borrowed.release();
    }
  },
);

it("retains both remote projects and closes only the requested one", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(10, "/a"))
    .mockResolvedValueOnce(info(20, "/b"));
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/a");
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/b");
  const first = harnessProjectEnvironmentId("p1", "/a");
  const second = harnessProjectEnvironmentId("p1", "/b");
  expect(
    Object.keys(useHarnessProjectEnvStore.getState().projects),
  ).toHaveLength(2);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  await useHarnessProjectEnvStore.getState().disconnect(first);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(10);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(20);
  expect(projectReport("/b").env).toMatchObject({
    kind: "ssh",
    sessionId: 20,
  });
  expect(useHarnessProjectEnvStore.getState().projects[first]).toBeUndefined();
  expect(
    useHarnessProjectEnvStore.getState().projects[second].env,
  ).toMatchObject({ sessionId: 20 });
});

it("preserves a new project created synchronously during another project's release", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(10, "/a"))
    .mockResolvedValueOnce(info(20, "/b"));
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/a");
  const first = harnessProjectEnvironmentId("p1", "/a");
  let requested = false;
  let connecting: Promise<unknown> | undefined;
  const unsubscribe = useHarnessProjectEnvStore.subscribe((state) => {
    if (!requested && !state.projects[first]) {
      requested = true;
      connecting = state.connect(
        { ...profile, id: "p2", host: "other.test" } as never,
        "/b",
      );
    }
  });
  try {
    await useHarnessProjectEnvStore.getState().disconnect(first);
    await connecting;
    expect(projectReport("/b", "p2").env).toMatchObject({
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
    if (!requested && state.projects[projectId]?.connecting) {
      requested = true;
      duplicate = state.connect(profile as never, "/srv/app");
    }
  });
  try {
    const env = await useHarnessProjectEnvStore
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

it("reads a local surface without releasing a remote project", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  const projects = useHarnessProjectEnvStore.getState().projects;
  expect(harnessProjectEnvironmentFor(null, projects).env).toEqual({
    kind: "local",
  });
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  expect(projectReport("/srv/app").env).toMatchObject({
    kind: "ssh",
    sessionId: 5,
  });
});

it("does not close the just-acquired session when connecting twice to the same project", async () => {
  const first = await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  const second = await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  expect(second).toEqual(first);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  expect(remoteSessions.snapshot()[0].leases).toBe(1);
});

it("reconnects a shared root without releasing another consumer's lease", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  const other = await remoteSessions.acquire(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
  );
  try {
    await useHarnessProjectEnvStore
      .getState()
      .reconnect(profile as never, "/srv/app");
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0].leases).toBe(2);
    await useHarnessProjectEnvStore
      .getState()
      .disconnect(harnessProjectEnvironmentId("p1", "/srv/app"));
    expect(remoteSessions.snapshot()[0].leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  } finally {
    other.release();
  }
});

it("keeps independent projects when an older project connects late", async () => {
  let finish!: (value: ReturnType<typeof info>) => void;
  mocks.openRemoteWorkspace
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(info(20, "/b"));
  const first = useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/a");
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/b");
  finish(info(10, "/a"));
  await first;
  expect(projectReport("/b").env).toMatchObject({ sessionId: 20 });
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
  const connecting = useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/pending");
  const rejected = expect(connecting).rejects.toThrow("cancelled");
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await useHarnessProjectEnvStore
    .getState()
    .disconnect(harnessProjectEnvironmentId("p1", "/pending"));
  finish(info(12, "/pending"));
  await rejected;
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(12);
  expect(useHarnessProjectEnvStore.getState().projects).toEqual({});
  expect(projectReport("/pending").env).toEqual({ kind: "local" });
});

it("cleans a profile's background projects while preserving another profile", async () => {
  const otherProfile = { ...profile, id: "p2", host: "other.test" };
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(10, "/a"))
    .mockResolvedValueOnce(info(20, "/b"));
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/a");
  await useHarnessProjectEnvStore
    .getState()
    .connect(otherProfile as never, "/b");
  await useHarnessProjectEnvStore
    .getState()
    .disconnectProfiles(new Set(["p1"]));
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(10);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(20);
  expect(projectReport("/b", "p2").env).toMatchObject({
    connection: { id: "p2" },
    sessionId: 20,
  });
});

it("recovers a cached project lease after the pool invalidates its session", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  mocks.openRemoteWorkspace.mockResolvedValueOnce(info(6));
  remoteSessions.invalidate({ profileId: "p1", root: "/srv/app" }, 5);
  const recovered = await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  expect(recovered).toMatchObject({ sessionId: 6 });
  expect(projectReport("/srv/app").env).toMatchObject({ sessionId: 6 });
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
      useHarnessProjectEnvStore
        .getState()
        .connect(
          { ...profile, id: `capacity-${index}` } as never,
          ".",
          `capacity-project-${index}`,
        ),
  );
  const completed = Promise.all(connections);
  const admittedBefore = Object.keys(
    useHarnessProjectEnvStore.getState().projects,
  );
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  expect(finishes).toHaveLength(MAX_PROJECT_ENVIRONMENT_OWNERS);
  const forceRequests = Array.from({ length: 2 }, () =>
    useHarnessProjectEnvStore
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
  expect(Object.keys(useHarnessProjectEnvStore.getState().projects)).toEqual(
    admittedBefore,
  );
  expect(
    harnessProjectEnvironmentFor(
      `capacity-project-${MAX_PROJECT_ENVIRONMENT_OWNERS - 1}`,
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({
    sessionId: 1000 + MAX_PROJECT_ENVIRONMENT_OWNERS - 1,
  });
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(
    MAX_PROJECT_ENVIRONMENT_OWNERS,
  );
});

it("never closes a borrowed pooled id without a matching project owner", async () => {
  const other = await remoteSessions.acquire(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
  );
  try {
    await useHarnessProjectEnvStore
      .getState()
      .disconnect(harnessProjectEnvironmentId("p1", "/srv/app"));
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
    await useHarnessProjectEnvStore.getState().connect(profile as never, root);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      root,
    );
    expect(projectReport(root).env).toMatchObject({
      kind: "ssh",
      root,
    });
    expect(Object.keys(useHarnessProjectEnvStore.getState().projects)).toEqual([
      harnessProjectEnvironmentId("p1", root),
    ]);
  },
);

it("returns a rejected promise for malformed input rather than throwing into an effect", async () => {
  let connecting!: Promise<unknown>;
  expect(() => {
    connecting = useHarnessProjectEnvStore
      .getState()
      .connect(profile as never, 42 as never);
  }).not.toThrow();
  await expect(connecting).rejects.toBeInstanceOf(TypeError);
  expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
});

it("reads and closes the actual root of a default-root owner", async () => {
  const owner = harnessProjectEnvironmentId("p1", ".");
  const actual = harnessProjectEnvironmentId("p1", "/real");
  mocks.openRemoteWorkspace.mockResolvedValue(info(5, "/real"));
  await useHarnessProjectEnvStore.getState().connect(profile as never, ".");
  expect(
    harnessProjectEnvironmentFor(
      actual,
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({ sessionId: 5, root: "/real" });
  expect(Object.keys(useHarnessProjectEnvStore.getState().projects)).toEqual([
    owner,
  ]);
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/real", actual);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(remoteSessions.snapshot()[0].leases).toBe(1);
  await useHarnessProjectEnvStore.getState().disconnect(actual);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(5);
  expect(useHarnessProjectEnvStore.getState().projects).toEqual({});
});

it("reuses and closes a fallback owner through its confirmed actual root", async () => {
  mocks.openRemoteWorkspace
    .mockRejectedValueOnce(new Error("missing"))
    .mockResolvedValueOnce(info(6, "/real"));
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/missing");
  const actual = harnessProjectEnvironmentId("p1", "/real");
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/real", actual);
  expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(2);
  expect(Object.keys(useHarnessProjectEnvStore.getState().projects)).toEqual([
    harnessProjectEnvironmentId("p1", "/missing"),
  ]);
  await useHarnessProjectEnvStore.getState().disconnect(actual);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(6);
});

it("reconnects a default-root alias at its actual root, not a changed login home", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(5, "/real"))
    .mockResolvedValueOnce(info(6, "/real"));
  await useHarnessProjectEnvStore.getState().connect(profile as never, ".");
  const actual = harnessProjectEnvironmentId("p1", "/real");
  await useHarnessProjectEnvStore
    .getState()
    .reconnect(profile as never, "/real", actual);
  expect(mocks.openRemoteWorkspace).toHaveBeenLastCalledWith(
    expect.anything(),
    "/real",
  );
  expect(
    Object.keys(useHarnessProjectEnvStore.getState().projects),
  ).toHaveLength(1);
  expect(
    harnessProjectEnvironmentFor(
      actual,
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({ sessionId: 6 });
});

it("keeps a known project alias addressable while its reconnect fails", async () => {
  await useHarnessProjectEnvStore.getState().connect(profile as never, ".");
  mocks.openRemoteWorkspace.mockRejectedValue(new Error("auth failed"));
  const actual = harnessProjectEnvironmentId("p1", "/srv/app");
  await expect(
    useHarnessProjectEnvStore
      .getState()
      .reconnect(profile as never, "/srv/app", actual),
  ).rejects.toThrow("auth failed");
  expect(
    harnessProjectEnvironmentFor(
      actual,
      useHarnessProjectEnvStore.getState().projects,
    ),
  ).toMatchObject({
    env: { kind: "local" },
    connecting: false,
    error: "auth failed",
  });
  await useHarnessProjectEnvStore.getState().disconnect(actual);
  expect(useHarnessProjectEnvStore.getState().projects).toEqual({});
});

it("closes automatic aliases together without closing an explicit same-root owner", async () => {
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(5, "/real"))
    .mockResolvedValueOnce(info(6, "/real"));
  const actual = harnessProjectEnvironmentId("p1", "/real");
  await Promise.all([
    useHarnessProjectEnvStore.getState().connect(profile as never, "."),
    useHarnessProjectEnvStore
      .getState()
      .connect(profile as never, "/real", actual),
  ]);
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/real", "alpha");
  await useHarnessProjectEnvStore.getState().disconnect(actual);
  expect(Object.keys(useHarnessProjectEnvStore.getState().projects)).toEqual([
    "alpha",
  ]);
  expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(5);
  expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(6);
  expect(
    remoteSessions.snapshot().find((entry) => entry.sessionId === 6)?.leases,
  ).toBe(1);
  expect(
    harnessProjectEnvironmentFor(
      "alpha",
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({ sessionId: 6 });
});

it("preserves a same-key reconnect created during atomic alias release", async () => {
  const actual = harnessProjectEnvironmentId("p1", "/real");
  const defaultId = harnessProjectEnvironmentId("p1", ".");
  mocks.openRemoteWorkspace
    .mockResolvedValueOnce(info(5, "/real"))
    .mockResolvedValueOnce(info(6, "/real"));
  await Promise.all([
    useHarnessProjectEnvStore.getState().connect(profile as never, "."),
    useHarnessProjectEnvStore
      .getState()
      .connect(profile as never, "/real", actual),
  ]);
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/real", "alpha");
  let requested = false;
  let reconnected: Promise<unknown> | undefined;
  const unsubscribe = useHarnessProjectEnvStore.subscribe((state) => {
    if (!requested && !state.projects[defaultId] && !state.projects[actual]) {
      requested = true;
      reconnected = state.connect(profile as never, "/real", actual);
    }
  });
  try {
    await useHarnessProjectEnvStore.getState().disconnect(actual);
    expect(reconnected).toBeDefined();
    await reconnected;
    expect(
      Object.keys(useHarnessProjectEnvStore.getState().projects),
    ).toContain(actual);
    expect(
      useHarnessProjectEnvStore.getState().projects[actual].env,
    ).toMatchObject({
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
  await useHarnessProjectEnvStore.getState().connect(profile as never, ".");
  const projects = useHarnessProjectEnvStore.getState().projects;
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
  await useHarnessProjectEnvStore.getState().connect(profile as never, ".");
  await useHarnessProjectEnvStore
    .getState()
    .connect({ ...profile, host: "other.test" } as never, "/real");
  expect(mocks.openRemoteWorkspace).toHaveBeenLastCalledWith(
    { host: "other.test", port: 22 },
    "/real",
  );
  expect(projectReport("/real").env).toMatchObject({
    sessionId: 6,
    connection: { host: "other.test" },
  });
});

it("opens a fresh same-root session when the saved connection configuration changes", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  mocks.openRemoteWorkspace.mockResolvedValueOnce(info(6));
  const env = await useHarnessProjectEnvStore
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
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app");
  const other = await remoteSessions.acquire(
    { profileId: "p1", root: "/srv/app" },
    { host: "example.test", port: 22 },
  );
  try {
    await expect(
      useHarnessProjectEnvStore
        .getState()
        .connect({ ...profile, host: "other.test" } as never, "/srv/app"),
    ).rejects.toMatchObject({ code: "REMOTE_SESSION_CONNECTION_CHANGED" });
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0].leases).toBe(1);
    expect(projectReport("/srv/app").env).toEqual({ kind: "local" });
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
  const first = useHarnessProjectEnvStore
    .getState()
    .connect(mutable as never, "/srv/app");
  const cancelled = expect(first).rejects.toThrow("cancelled");
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  mutable.host = "other.test";
  await expect(
    useHarnessProjectEnvStore.getState().connect(mutable as never, "/srv/app"),
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
  await useHarnessProjectEnvStore
    .getState()
    .connect(busyProfile as never, "/busy");
  const busyId = harnessProjectEnvironmentId(busyProfile.id, "/busy");
  const busyBefore = useHarnessProjectEnvStore.getState().projects[busyId];
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
      useHarnessProjectEnvStore
        .getState()
        .connect(profile as never, "/original"),
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
    expect(useHarnessProjectEnvStore.getState().projects[busyId]).toEqual(
      busyBefore,
    );
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
  await useHarnessProjectEnvStore
    .getState()
    .connect(busyProfile as never, "/busy");
  const busyId = harnessProjectEnvironmentId(busyProfile.id, "/busy");
  const busyBefore = useHarnessProjectEnvStore.getState().projects[busyId];
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
      useHarnessProjectEnvStore
        .getState()
        .connect(profile as never, "/blocked"),
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
    expect(useHarnessProjectEnvStore.getState().projects[busyId]).toEqual(
      busyBefore,
    );
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
    const env = await useHarnessProjectEnvStore
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
  await useHarnessProjectEnvStore
    .getState()
    .connect(profile as never, "/srv/app", "__proto__");
  expect(
    Object.getOwnPropertyDescriptor(
      useHarnessProjectEnvStore.getState().projects,
      "__proto__",
    ),
  ).toBeDefined();
  expect(
    harnessProjectEnvironmentFor(
      "__proto__",
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({
    kind: "ssh",
    sessionId: 5,
  });
});
