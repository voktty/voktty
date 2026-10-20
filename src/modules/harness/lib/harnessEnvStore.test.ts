import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openRemoteWorkspace: vi.fn(),
  closeRemoteWorkspace: vi.fn(),
}));

vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: mocks.openRemoteWorkspace,
  closeRemoteWorkspace: mocks.closeRemoteWorkspace,
}));
vi.mock("@/modules/connections/model/remoteSshProfiles", () => ({
  remoteSshConnectionForProfile: (profile: { host: string }) => ({
    host: profile.host,
    port: 22,
  }),
}));

import { remoteSessions } from "@/modules/remote/sessionManager";
import { useHarnessEnvStore } from "./harnessEnvStore";

const profile = { id: "p1", name: "prod", host: "example.test" };
const info = (id: number) => ({
  session_id: id,
  architecture: "x86_64",
  workspace_root: "/srv/app",
  helper_version: "1",
  capabilities: [],
});

beforeEach(async () => {
  await useHarnessEnvStore.getState().disconnect();
  await remoteSessions.closeAll();
  useHarnessEnvStore.setState({ env: { kind: "local" }, connecting: false, error: null });
  mocks.openRemoteWorkspace.mockReset().mockResolvedValue(info(5));
  mocks.closeRemoteWorkspace.mockReset().mockResolvedValue(undefined);
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