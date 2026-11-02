// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  reserveRawChild,
  type RawChildHandle,
} from "@/modules/harness/lib/harness/child";
import { RemoteSessionPool } from "@/modules/remote/sessionPool";
import { captureRemoteMemorySource } from "@/modules/workspace-kit/lib/remoteMemorySource";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  probe: vi.fn(),
  acquire: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.probe,
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
  openHeldRemoteSession: vi.fn(),
  releaseHeldRemoteSession: vi.fn(),
}));

const profile = { id: "child-memory", name: "Host", host: "original.invalid" };
const cwd = "remote://voktty-ssh-child-memory/project";
let pool: RemoteSessionPool;
let children: RawChildHandle[];
let sources: ReturnType<typeof captureRemoteMemorySource>[];
function child() {
  const result = reserveRawChild(crypto.randomUUID());
  children.push(result);
  return result;
}
function source() {
  const result = captureRemoteMemorySource({
    path: cwd,
    environment: { kind: "local" },
    source: "memory",
  });
  sources.push(result);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  children = [];
  sources = [];
  usePreferencesStore.setState({ sshConnections: [profile] });
  rememberRemoteProject("voktty-ssh-child-memory", {
    id: "project",
    name: "Project",
    cwd: "/project",
  });
  io.open.mockResolvedValue({
    session_id: 7,
    workspace_root: "/canonical/project",
    architecture: "x86_64",
    helper_version: "1",
    capabilities: ["agent.probe"],
  });
  io.close.mockResolvedValue(undefined);
  pool = new RemoteSessionPool({
    open: io.open,
    close: io.close,
    idleMs: 30_000,
    schedule: () => () => {},
  });
  io.acquire.mockImplementation((...args: Parameters<typeof pool.acquire>) =>
    pool.acquire(...args),
  );
  io.probe.mockResolvedValue({
    found: true,
    path: "/usr/bin/claude",
    version: "2.1.312 (Claude Code)",
  });
  io.invoke.mockImplementation(async (command) =>
    command === "harness_spawn" ? 12345 : undefined,
  );
});
afterEach(async () => {
  await Promise.all(children.map((value) => value.close()));
  for (const value of sources) value.dispose();
  await pool.closeAll();
});

it("probes the remote CLI and spawns on the same owned helper and captured connection", async () => {
  const handle = child();
  const origin = source();
  expect(await handle.probeRemote?.("claude", cwd)).toMatchObject({
    version: "2.1.312 (Claude Code)",
  });
  handle.assertMemorySource?.(origin.selectionKey);
  await handle.spawn("claude", ["--replay-user-messages"], cwd);
  expect(io.open).toHaveBeenCalledOnce();
  expect(io.probe).toHaveBeenCalledExactlyOnceWith(7, "agent.probe", {
    command: "claude",
  });
  expect(io.invoke).toHaveBeenCalledWith(
    "harness_spawn",
    expect.objectContaining({
      remoteSessionId: 7,
      remoteRoot: "/canonical/project",
      remoteRelativeCwd: ".",
      remoteConnection: expect.objectContaining({ host: "original.invalid" }),
    }),
  );
  await handle.close();
  expect(io.close).toHaveBeenCalledExactlyOnceWith(7);
});

it("does not send memory to an old process after a saved profile round trip", async () => {
  const handle = child();
  const origin = source();
  await handle.spawn("codex", ["app-server"], cwd);
  handle.assertMemorySource?.(origin.selectionKey);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  expect(() => handle.assertMemorySource?.(source().selectionKey)).toThrowError(
    "cancelled",
  );
  expect(handle.retired).toBe(false);
});

it("rejects another origin and cannot rebind a probed child to another command or directory", async () => {
  const handle = child();
  await handle.probeRemote?.("claude", cwd);
  expect(() => handle.assertMemorySource?.("foreign")).toThrowError(
    "source changed",
  );
  await expect(handle.probeRemote?.("codex", cwd)).rejects.toThrowError(
    "source changed",
  );
  await expect(handle.spawn("claude", [], `${cwd}/other`)).rejects.toThrowError(
    "source changed",
  );
  expect(
    io.invoke.mock.calls.some(([command]) => command === "harness_spawn"),
  ).toBe(false);
});

it("requires remote version capability and never falls back to a local executable", async () => {
  io.open.mockResolvedValueOnce({
    session_id: 7,
    workspace_root: "/project",
    architecture: "x86_64",
    helper_version: "old",
    capabilities: [],
  });
  await expect(child().probeRemote?.("claude", cwd)).rejects.toThrowError(
    "verification is unavailable",
  );
  expect(io.probe).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("keeps an unfinished probe owned through close and never starts a late process", async () => {
  const gate = deferred<{ found: boolean; version: string }>();
  const started = deferred<void>();
  io.probe.mockImplementation(async () => {
    started.resolve();
    return gate.promise;
  });
  const handle = child();
  const probe = handle.probeRemote?.("claude", cwd);
  const rejected = expect(probe).rejects.toThrowError("retired");
  await started.promise;
  let closed = false;
  const closing = handle.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(io.close).not.toHaveBeenCalled();
  gate.resolve({ found: true, version: "2.1.312" });
  await rejected;
  await closing;
  expect(io.close).toHaveBeenCalledExactlyOnceWith(7);
  expect(io.invoke).not.toHaveBeenCalled();
});
