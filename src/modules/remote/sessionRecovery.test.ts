import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
}));

vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  openRemoteWorkspace: mocks.open,
  closeRemoteWorkspace: mocks.close,
  requestRemoteResult: mocks.request,
}));

import {
  clearRemoteSessionAliases,
  liveRemoteSessionId,
  recordRemoteSessionReplacement,
} from "./sessionAliases";
import {
  closeRemoteSessionById,
  onRemoteSessionRecovered,
  openHeldRemoteSession,
  recoverLostRemoteSession,
  remoteSessions,
} from "./sessionManager";
import {
  remoteDelete,
  remoteReadDir,
  withLostSessionRecovery,
} from "./filesystem";

const connection = { host: "example.test", port: 22 };
const info = (id: number) => ({
  session_id: id,
  architecture: "x86_64",
  workspace_root: "/srv/app",
  helper_version: "1",
  capabilities: [],
});
const env = (sessionId: number): Extract<WorkspaceEnv, { kind: "ssh" }> => ({
  kind: "ssh",
  connection: { id: "p1", name: "Server", host: "example.test" },
  root: "/srv/app",
  sessionId,
});
const lost = () => new Error("remote session 5 not found");

beforeEach(async () => {
  await remoteSessions.closeAll();
  clearRemoteSessionAliases();
  mocks.open.mockReset();
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset();
});

it("resolves a chain of replaced sessions and never loops", () => {
  recordRemoteSessionReplacement(1, 2);
  recordRemoteSessionReplacement(2, 3);
  expect(liveRemoteSessionId(1)).toBe(3);
  recordRemoteSessionReplacement(3, 1);
  expect(liveRemoteSessionId(3)).toBe(3);
  expect(liveRemoteSessionId(9)).toBe(9);
});

it("reopens a lost session once for concurrent callers and moves its holds", async () => {
  mocks.open.mockResolvedValueOnce(info(5)).mockResolvedValueOnce(info(6));
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");
  const recovered = vi.fn();
  const stop = onRemoteSessionRecovered(recovered);

  const [first, second] = await Promise.all([
    recoverLostRemoteSession(5, "p1", connection, "/srv/app"),
    recoverLostRemoteSession(5, "p1", connection, "/srv/app"),
  ]);
  stop();

  expect(first.session_id).toBe(6);
  expect(second.session_id).toBe(6);
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(liveRemoteSessionId(5)).toBe(6);
  expect(recovered).toHaveBeenCalledWith(5, 6);

  // The holder that kept the old id releases the replacement.
  await closeRemoteSessionById("workspace", 5);
  expect(mocks.close).toHaveBeenCalledWith(6);
  expect(remoteSessions.snapshot()).toEqual([]);
});

it("does not retry a failed recovery until the cooldown passes", async () => {
  mocks.open
    .mockResolvedValueOnce(info(7))
    .mockRejectedValueOnce(new Error("host unreachable"));
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");

  await expect(
    recoverLostRemoteSession(7, "p1", connection, "/srv/app"),
  ).rejects.toThrow("host unreachable");
  await expect(
    recoverLostRemoteSession(7, "p1", connection, "/srv/app"),
  ).rejects.toThrow("host unreachable");
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

it("retries a read on the recovered session", async () => {
  mocks.open.mockResolvedValueOnce(info(5)).mockResolvedValueOnce(info(6));
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");
  mocks.request
    .mockRejectedValueOnce(lost())
    .mockResolvedValueOnce({ entries: [] });

  await expect(remoteReadDir(env(5), "/srv/app")).resolves.toEqual([]);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(liveRemoteSessionId(5)).toBe(6);
});

it("recovers but does not repeat a delete that may already have run", async () => {
  mocks.open.mockResolvedValueOnce(info(5)).mockResolvedValueOnce(info(6));
  await openHeldRemoteSession("workspace", "p1", connection, "/srv/app");
  mocks.request.mockRejectedValueOnce(lost());

  await expect(remoteDelete(env(5), "/srv/app/a.txt")).rejects.toThrow(
    "not found",
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(liveRemoteSessionId(5)).toBe(6);
});

it("leaves other failures alone", async () => {
  const run = vi.fn().mockRejectedValue(new Error("permission denied"));
  await expect(withLostSessionRecovery(env(5), true, run)).rejects.toThrow(
    "permission denied",
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(mocks.open).not.toHaveBeenCalled();
});
