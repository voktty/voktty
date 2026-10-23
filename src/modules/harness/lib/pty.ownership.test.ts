import { afterEach, expect, it, vi } from "vitest";
import type { PtySession } from "@/modules/terminal/lib/pty-bridge";
const mocks = vi.hoisted(() => ({ open: vi.fn(), status: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.status }));
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({ openPty: mocks.open }));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: vi.fn().mockResolvedValue(undefined),
}));
import {
  killAllPtys,
  spawnPty,
  startOwnedPty,
  subscribePty,
  writePty,
} from "@/modules/harness/lib/pty";

function pty(id: number) {
  return {
    id,
    close: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
afterEach(async () => {
  await killAllPtys();
  vi.resetAllMocks();
});

it("closes only the captured live incarnation and never a replacement with the same logical id", async () => {
  const first = pty(1);
  const next = pty(2);
  mocks.open.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const old = startOwnedPty("same", "/srv/app", 80, 24);
  await old.ready;
  await spawnPty("same", "/srv/app", 80, 24);
  await old.close();
  await old.close();
  expect(first.close).toHaveBeenCalledOnce();
  expect(next.close).not.toHaveBeenCalled();
  await old.write("stale\r");
  await old.resize(120, 40);
  expect(next.write).not.toHaveBeenCalled();
  expect(next.resize).not.toHaveBeenCalled();
  await expect(old.status()).resolves.toBeUndefined();
  expect(mocks.status).not.toHaveBeenCalled();
  await writePty("same", "keep\r");
  expect(next.write).toHaveBeenCalledWith("keep\r");
});
it("waits for its pending opening while preserving a successor's handlers and transport", async () => {
  const pending = deferred<PtySession>();
  const first = pty(1);
  const next = pty(2);
  mocks.open.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(next);
  const old = startOwnedPty("pending", "/srv/app", 80, 24);
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  let closed = false;
  const closing = old.close().then(() => {
    closed = true;
  });
  await spawnPty("pending", "/srv/app", 80, 24);
  const data = vi.fn();
  const exit = vi.fn();
  subscribePty("pending", data, exit);
  expect(closed).toBe(false);
  pending.resolve(first);
  await closing;
  expect(first.close).toHaveBeenCalledOnce();
  expect(next.close).not.toHaveBeenCalled();
  const handlers = mocks.open.mock.calls[1][2];
  handlers.onData(new Uint8Array([7]));
  expect(data).toHaveBeenCalledExactlyOnceWith(new Uint8Array([7]));
  await writePty("pending", "successor\r");
  expect(next.write).toHaveBeenCalledWith("successor\r");
});
it("coalesces its exact close through actual native close settlement", async () => {
  const pending = deferred<void>();
  const session = pty(3);
  session.close.mockReturnValue(pending.promise);
  mocks.open.mockResolvedValueOnce(session);
  const owner = startOwnedPty("coalesced", "/srv/app", 80, 24);
  await owner.ready;
  await owner.write("current\r");
  await owner.resize(100, 30);
  expect(session.write).toHaveBeenCalledWith("current\r");
  expect(session.resize).toHaveBeenCalledWith(100, 30);
  const first = owner.close();
  expect(owner.isCurrent()).toBe(false);
  await owner.write("after close\r");
  await owner.resize(200, 60);
  expect(session.write).toHaveBeenCalledOnce();
  expect(session.resize).toHaveBeenCalledOnce();
  expect(owner.close()).toBe(first);
  await vi.waitFor(() => expect(session.close).toHaveBeenCalledOnce());
  let settled = false;
  void first.then(() => {
    settled = true;
  });
  expect(settled).toBe(false);
  pending.resolve();
  await first;
  expect(owner.close()).toBe(first);
  expect(session.close).toHaveBeenCalledOnce();
});
it("discards a status result when its exact transport was superseded during the read", async () => {
  const reply = deferred<boolean>();
  mocks.open.mockResolvedValueOnce(pty(1)).mockResolvedValueOnce(pty(2));
  mocks.status.mockReturnValueOnce(reply.promise);
  const old = startOwnedPty("status", "/srv/app", 80, 24);
  await old.ready;
  const status = old.status();
  expect(mocks.status).toHaveBeenCalledWith("pty_has_foreground_process", {
    id: 1,
  });
  await spawnPty("status", "/srv/app", 80, 24);
  reply.resolve(true);
  await expect(status).resolves.toBeUndefined();
  expect(old.isCurrent()).toBe(false);
});

it("cannot retire an incarnation created after global legacy cleanup", async () => {
  const first = pty(1);
  const next = pty(2);
  mocks.open.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const old = startOwnedPty("reaped", "/srv/app", 80, 24);
  await old.ready;
  await killAllPtys();
  await spawnPty("reaped", "/srv/app", 80, 24);
  await old.close();
  expect(next.close).not.toHaveBeenCalled();
});
