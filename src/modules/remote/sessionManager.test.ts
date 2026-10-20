import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
}));

vi.mock("./client", () => ({
  openRemoteWorkspace: mocks.open,
  closeRemoteWorkspace: mocks.close,
}));

import {
  closeRemoteSessionById,
  openHeldRemoteSession,
  remoteSessions,
} from "./sessionManager";

const connection = { host: "example.test", port: 22 };
const info = (id: number) => ({
  session_id: id,
  architecture: "x86_64",
  workspace_root: "/srv/app",
  helper_version: "1",
  capabilities: [],
});

beforeEach(async () => {
  await remoteSessions.closeAll();
  mocks.open.mockReset().mockResolvedValue(info(5));
  mocks.close.mockReset().mockResolvedValue(undefined);
});

it("shares one session between surfaces and closes it when the last holder leaves", async () => {
  const terminal = await openHeldRemoteSession(
    "workspace",
    "p1",
    connection,
    "/srv/app",
  );
  const harness = await openHeldRemoteSession(
    "harness",
    "p1",
    connection,
    "/srv/app",
  );
  expect(terminal.session_id).toBe(harness.session_id);
  expect(mocks.open).toHaveBeenCalledTimes(1);

  await closeRemoteSessionById("workspace", 5);
  expect(mocks.close).not.toHaveBeenCalled();
  await closeRemoteSessionById("harness", 5);
  expect(mocks.close).toHaveBeenCalledWith(5);
  expect(remoteSessions.snapshot()).toEqual([]);
});

it("releases every hold of a holder with one close so none leaks", async () => {
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");
  await closeRemoteSessionById("workspace", 5);
  expect(mocks.close).toHaveBeenCalledWith(5);
  expect(remoteSessions.snapshot()).toEqual([]);
});

it("keeps a session open while a command still uses it", async () => {
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");
  let release: () => void = () => undefined;
  const running = remoteSessions.use(
    { profileId: "p1", root: "/srv/app" },
    connection,
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  await Promise.resolve();
  await closeRemoteSessionById("workspace", 5);
  expect(mocks.close).not.toHaveBeenCalled();
  release();
  await running;
});

it("closes a session that was never pooled directly", async () => {
  await closeRemoteSessionById("workspace", 77);
  expect(mocks.close).toHaveBeenCalledWith(77);
});

it("does not close twice a session the pool already discarded", async () => {
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");
  await remoteSessions.closeProfile("p1");
  mocks.close.mockClear();
  await closeRemoteSessionById("workspace", 5);
  expect(mocks.close).not.toHaveBeenCalled();
});