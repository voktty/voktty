import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PtySession } from "@/modules/terminal/lib/pty-bridge";

const mocks = vi.hoisted(() => ({ open: vi.fn(), acquire: vi.fn() }));
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({ openPty: mocks.open }));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: mocks.acquire,
}));
import {
  killAllPtys,
  killPty,
  spawnPty,
  startOwnedPty,
  writePty,
} from "@/modules/harness/lib/pty";

function session(id: number) {
  return {
    id,
    close: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
  };
}
function target() {
  const releaseAndClose = vi.fn().mockResolvedValue(undefined);
  return {
    cwd: "/srv/app",
    workspace: { kind: "local" },
    lease: { info: { session_id: 71 }, releaseAndClose },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.acquire.mockResolvedValue(undefined);
});
afterEach(async () => {
  await killAllPtys();
  vi.resetAllMocks();
});

it("retains a rejected native close and its helper until the original owner retries successfully", async () => {
  const pty = session(1);
  const remote = target();
  mocks.acquire.mockResolvedValueOnce(remote);
  mocks.open.mockResolvedValueOnce(pty);
  const owner = startOwnedPty("retry-native", "/srv/app", 80, 24);
  await owner.ready;
  const error = new Error("native close pending");
  pty.close.mockRejectedValueOnce(error);
  await expect(owner.close()).rejects.toBe(error);
  expect(owner.isCurrent()).toBe(false);
  await owner.write("retired\r");
  await writePty("retry-native", "retired\r");
  expect(pty.write).not.toHaveBeenCalled();
  expect(remote.lease.releaseAndClose).not.toHaveBeenCalled();
  const nativeClose = deferred<void>();
  pty.close.mockReturnValueOnce(nativeClose.promise);
  const retry = owner.close();
  expect(owner.close()).toBe(retry);
  await vi.waitFor(() => expect(pty.close).toHaveBeenCalledTimes(2));
  expect(remote.lease.releaseAndClose).not.toHaveBeenCalled();
  nativeClose.resolve();
  await retry;
  expect(remote.lease.releaseAndClose).toHaveBeenCalledOnce();
  expect(owner.close()).toBe(retry);
});

it("blocks replacement acquisition while the predecessor native close is still failing", async () => {
  const pty = session(1);
  mocks.open.mockResolvedValueOnce(pty);
  await spawnPty("blocked-native", "/srv/app", 80, 24);
  pty.close.mockRejectedValueOnce(new Error("native close failed"));
  await expect(spawnPty("blocked-native", "/srv/app", 80, 24)).rejects.toThrow(
    "native close failed",
  );
  expect(mocks.acquire).toHaveBeenCalledOnce();
  expect(mocks.open).toHaveBeenCalledOnce();
  mocks.open.mockResolvedValueOnce(session(2));
  await spawnPty("blocked-native", "/srv/app", 80, 24);
  expect(pty.close).toHaveBeenCalledTimes(2);
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

it("keeps native failures from a global cleanup available for an exact later retry", async () => {
  const pty = session(1);
  const remote = target();
  mocks.acquire.mockResolvedValueOnce(remote);
  mocks.open.mockResolvedValueOnce(pty);
  await spawnPty("global-native", "/srv/app", 80, 24);
  pty.close.mockRejectedValueOnce(new Error("native close failed"));
  await killAllPtys();
  expect(remote.lease.releaseAndClose).not.toHaveBeenCalled();
  await killAllPtys();
  expect(pty.close).toHaveBeenCalledTimes(2);
  expect(remote.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it("retries failed cleanup after an exit using the original owner even though its spawn token retired", async () => {
  const pty = session(1);
  const remote = target();
  mocks.acquire.mockResolvedValueOnce(remote);
  mocks.open.mockResolvedValueOnce(pty);
  const owner = startOwnedPty("exit-native", "/srv/app", 80, 24);
  await owner.ready;
  pty.close.mockRejectedValueOnce(new Error("native close failed"));
  mocks.open.mock.calls[0][2].onExit(0);
  await vi.waitFor(() => expect(pty.close).toHaveBeenCalledOnce());
  expect(remote.lease.releaseAndClose).not.toHaveBeenCalled();
  await owner.close();
  expect(pty.close).toHaveBeenCalledTimes(2);
  expect(remote.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it("retains a cancelled late native resource whose cleanup fails without releasing its helper", async () => {
  const pending = deferred<PtySession>();
  const pty = session(1);
  const remote = target();
  mocks.acquire.mockResolvedValueOnce(remote);
  mocks.open.mockReturnValueOnce(pending.promise);
  const opening = spawnPty("late-native", "/srv/app", 80, 24);
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  await killPty("late-native");
  pty.close.mockRejectedValueOnce(new Error("late close failed"));
  const failed = expect(opening).rejects.toThrow("late close failed");
  pending.resolve(pty);
  await failed;
  expect(remote.lease.releaseAndClose).not.toHaveBeenCalled();
  await killPty("late-native");
  expect(pty.close).toHaveBeenCalledTimes(2);
  expect(remote.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it("retries a superseded late resource without selecting the live same-ID successor", async () => {
  const pending = deferred<PtySession>();
  const oldPty = session(1);
  const nextPty = session(2);
  const oldTarget = target();
  const nextTarget = target();
  mocks.acquire
    .mockResolvedValueOnce(oldTarget)
    .mockResolvedValueOnce(nextTarget);
  mocks.open
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(nextPty);
  const old = startOwnedPty("late-successor", "/srv/app", 80, 24);
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  await spawnPty("late-successor", "/srv/app", 80, 24);
  oldPty.close.mockRejectedValueOnce(new Error("old cleanup failed"));
  const failed = expect(old.ready).rejects.toThrow("old cleanup failed");
  pending.resolve(oldPty);
  await failed;
  await old.close();
  expect(oldPty.close).toHaveBeenCalledTimes(2);
  expect(oldTarget.lease.releaseAndClose).toHaveBeenCalledOnce();
  expect(nextPty.close).not.toHaveBeenCalled();
  expect(nextTarget.lease.releaseAndClose).not.toHaveBeenCalled();
  await writePty("late-successor", "keep\r");
  expect(nextPty.write).toHaveBeenCalledWith("keep\r");
});

it("keeps pending cancelled openings charged until their late resources settle", async () => {
  const pending = deferred<void>();
  let nextId = 0;
  mocks.open.mockImplementation(() => {
    const captured = session(nextId++);
    return pending.promise.then(() => captured);
  });
  const openings = Array.from({ length: 256 }, (_, index) =>
    spawnPty(`opening-${index}`, "/srv/app", 80, 24),
  );
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(256));
  await killAllPtys();
  await expect(spawnPty("over-capacity", "/srv/app", 80, 24)).rejects.toThrow(
    "resource limit",
  );
  expect(mocks.open).toHaveBeenCalledTimes(256);
  pending.resolve();
  await Promise.all(openings);
  mocks.open.mockResolvedValueOnce(session(2));
  await spawnPty("capacity-restored", "/srv/app", 80, 24);
});

it("keeps failed native resources charged until a later global retry succeeds", async () => {
  const sessions = Array.from({ length: 256 }, (_, index) => session(index));
  for (const pty of sessions) mocks.open.mockResolvedValueOnce(pty);
  await Promise.all(
    sessions.map((_, index) => spawnPty(`failed-${index}`, "/srv/app", 80, 24)),
  );
  for (const pty of sessions)
    pty.close.mockRejectedValueOnce(new Error("cleanup pending"));
  await killAllPtys();
  await expect(
    spawnPty("over-failed-capacity", "/srv/app", 80, 24),
  ).rejects.toThrow("resource limit");
  await killAllPtys();
  mocks.open.mockResolvedValueOnce(session(300));
  await spawnPty("failed-capacity-restored", "/srv/app", 80, 24);
});
