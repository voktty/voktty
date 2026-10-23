import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  releaseAndClose: vi.fn(),
}));
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

beforeEach(() => {
  mocks.releaseAndClose.mockResolvedValue(undefined);
  mocks.acquire.mockResolvedValue({
    cwd: "/srv/app",
    workspace: { kind: "local" },
    lease: {
      info: { session_id: 71 },
      release: mocks.release,
      releaseAndClose: mocks.releaseAndClose,
    },
  });
  mocks.open.mockResolvedValue(session(1));
});
afterEach(async () => {
  mocks.releaseAndClose.mockResolvedValue(undefined);
  await killAllPtys();
  vi.resetAllMocks();
});

it("retains the captured helper cleanup after rejection and retries without closing the PTY twice", async () => {
  const pty = session(1);
  mocks.open.mockResolvedValueOnce(pty);
  await spawnPty("retry", "/srv/app", 80, 24);
  const error = new Error("helper cleanup pending");
  mocks.releaseAndClose.mockRejectedValueOnce(error);
  await expect(killPty("retry")).rejects.toBe(error);
  expect(mocks.release).not.toHaveBeenCalled();
  await killPty("retry");
  expect(mocks.releaseAndClose).toHaveBeenCalledTimes(2);
  expect(pty.close).toHaveBeenCalledOnce();
  await killPty("retry");
  expect(mocks.releaseAndClose).toHaveBeenCalledTimes(2);
});

it("lets the original owner retry its failed helper close without touching a same-ID successor", async () => {
  const old = startOwnedPty("owner", "/srv/app", 80, 24);
  await old.ready;
  const error = new Error("helper cleanup pending");
  mocks.releaseAndClose.mockRejectedValueOnce(error);
  await expect(old.close()).rejects.toBe(error);
  const next = session(2);
  const nextClose = vi.fn().mockResolvedValue(undefined);
  mocks.acquire.mockResolvedValueOnce({
    cwd: "/srv/app",
    workspace: { kind: "local" },
    lease: { info: { session_id: 72 }, releaseAndClose: nextClose },
  });
  mocks.open.mockResolvedValueOnce(next);
  await spawnPty("owner", "/srv/app", 80, 24);
  await old.close();
  expect(next.close).not.toHaveBeenCalled();
  expect(nextClose).not.toHaveBeenCalled();
  await writePty("owner", "keep\r");
  expect(next.write).toHaveBeenCalledWith("keep\r");
  await killPty("owner");
  expect(nextClose).toHaveBeenCalledOnce();
});

it("retains failed exit cleanup for explicit retry without an unhandled rejection", async () => {
  await spawnPty("exit", "/srv/app", 80, 24);
  mocks.releaseAndClose.mockRejectedValueOnce(new Error("helper unavailable"));
  mocks.open.mock.calls[0][2].onExit(0);
  await vi.waitFor(() => expect(mocks.releaseAndClose).toHaveBeenCalledOnce());
  await killPty("exit");
  expect(mocks.releaseAndClose).toHaveBeenCalledTimes(2);
});

it("refuses replacement acquisition until the predecessor helper cleanup succeeds", async () => {
  await spawnPty("replacement", "/srv/app", 80, 24);
  mocks.releaseAndClose.mockRejectedValueOnce(new Error("cleanup pending"));
  await expect(spawnPty("replacement", "/srv/app", 80, 24)).rejects.toThrow(
    "cleanup pending",
  );
  expect(mocks.acquire).toHaveBeenCalledOnce();
  expect(mocks.open).toHaveBeenCalledOnce();
  await spawnPty("replacement", "/srv/app", 80, 24);
  expect(mocks.releaseAndClose).toHaveBeenCalledTimes(2);
  expect(mocks.acquire).toHaveBeenCalledTimes(2);
});

it("keeps failed startup helper cleanup addressable by the original terminal ID", async () => {
  mocks.open.mockRejectedValueOnce(new Error("PTY failed"));
  mocks.releaseAndClose.mockRejectedValueOnce(
    new Error("helper cleanup failed"),
  );
  await expect(spawnPty("startup", "/srv/app", 80, 24)).rejects.toThrow(
    "helper cleanup failed",
  );
  await killPty("startup");
  expect(mocks.releaseAndClose).toHaveBeenCalledTimes(2);
});

it("retains failed global helper cleanup for the next captured cleanup pass", async () => {
  await spawnPty("global", "/srv/app", 80, 24);
  mocks.releaseAndClose.mockRejectedValueOnce(
    new Error("helper cleanup failed"),
  );
  await killAllPtys();
  await killAllPtys();
  expect(mocks.releaseAndClose).toHaveBeenCalledTimes(2);
  await killAllPtys();
  expect(mocks.releaseAndClose).toHaveBeenCalledTimes(2);
});
