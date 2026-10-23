// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cancelSessionConnection,
  disposeSession,
  getLiveLeafCwd,
  respawnSession,
  useTerminalSession,
  waitForLeafConnection,
  writeToSession,
} from "@/modules/terminal/lib/useTerminalSession";
import {
  ownedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/modules/terminal/lib/rendererPool");
vi.mock("@/modules/terminal/lib/useTerminalFont", () => ({
  useTerminalFont: () => ({
    fontFamily: "monospace",
    fontWeight: "400",
    fontSize: 14,
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class<T> {
    onmessage: (value: T) => void = () => {};
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
let source: OwnedPtyTarget;
let helperId: number;
let ptyId: number;
const targets = new Map<number, OwnedPtyTarget>();
const acquire = vi.fn<(cwd: string) => Promise<OwnedPtyTarget>>();
const onCwd = vi.fn();
function target(id: number, cwd = "/srv/app"): OwnedPtyTarget {
  const value: OwnedPtyTarget = {
    cwd,
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: id,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    release: vi.fn().mockResolvedValue(undefined),
    acquireSibling: acquire,
  };
  targets.set(id, value);
  return value;
}
function Leaf() {
  const node = useRef<HTMLDivElement>(null);
  useTerminalSession({
    leafId: 1,
    container: node,
    visible: false,
    initialCwd: "/srv/app",
    workspaceEnv: source.workspace,
    onCwd,
  });
  return <div ref={node} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  targets.clear();
  helperId = 7;
  ptyId = 90;
  acquire.mockImplementation(async (cwd) => target(++helperId, cwd));
  source = target(7);
  ownedPtyTargets.register(1, source);
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "remote_pty_open"
      ? ++ptyId
      : command === "remote_pty_get_cwd"
        ? "/srv/app/current"
        : undefined,
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    disposeSession(1);
    root.unmount();
  });
  await ownedPtyTargets.close(1);
  expect(ownedPtyTargets.size()).toBe(0);
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<Leaf />));
  await waitForLeafConnection(1);
}
function opens() {
  return mocks.invoke.mock.calls.filter(
    ([command]) => command === "remote_pty_open",
  );
}

it("reconnects through the real bridge only after native close and helper release, then reads and writes with the new helper", async () => {
  await mount();
  const nativeClose = deferred<void>();
  const release = deferred<void>();
  vi.mocked(source.release).mockReturnValueOnce(release.promise);
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "remote_pty_close"
      ? nativeClose.promise
      : command === "remote_pty_open"
        ? ++ptyId
        : "/srv/app/current",
  );
  const reconnect = respawnSession(1, "/srv/app/src");
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("remote_pty_close", {
      sessionId: 7,
      ptyId: 91,
    }),
  );
  expect(acquire).not.toHaveBeenCalled();
  nativeClose.resolve();
  await vi.waitFor(() => expect(source.release).toHaveBeenCalledOnce());
  expect(opens()).toHaveLength(1);
  release.resolve();
  await act(async () => reconnect);
  await waitForLeafConnection(1);
  expect(acquire).toHaveBeenCalledExactlyOnceWith("/srv/app/src");
  expect(opens()[1][1]).toMatchObject({ sessionId: 8, cwd: "/srv/app/src" });
  expect(writeToSession(1, "work\r")).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "remote_pty_write",
    expect.any(Uint8Array),
    { headers: { "x-pty-id": "92", "x-remote-session-id": "8" } },
  );
  await getLiveLeafCwd(1);
  expect(mocks.invoke).toHaveBeenCalledWith("remote_pty_get_cwd", {
    sessionId: 8,
    ptyId: 92,
  });
  expect(targets.get(8)?.release).not.toHaveBeenCalled();
});

it("lets only the latest reconnect open after a shared predecessor cleanup", async () => {
  await mount();
  const release = deferred<void>();
  vi.mocked(source.release).mockReturnValueOnce(release.promise);
  const old = respawnSession(1, "/srv/app/old");
  const current = respawnSession(1, "/srv/app/new");
  release.resolve();
  await act(async () => Promise.all([old, current]));
  expect(acquire).toHaveBeenCalledExactlyOnceWith("/srv/app/new");
  expect(opens()).toHaveLength(2);
  expect(opens()[1][1]).toMatchObject({ sessionId: 8, cwd: "/srv/app/new" });
  await waitForLeafConnection(1);
});

it("cancels during old helper cleanup without admitting a replacement and permits an explicit retry", async () => {
  await mount();
  const release = deferred<void>();
  vi.mocked(source.release).mockReturnValueOnce(release.promise);
  const reconnect = respawnSession(1);
  cancelSessionConnection(1);
  release.resolve();
  await act(async () => reconnect);
  expect(acquire).not.toHaveBeenCalled();
  expect(opens()).toHaveLength(1);
  await expect(waitForLeafConnection(1)).rejects.toThrow();
  await act(async () => respawnSession(1));
  await waitForLeafConnection(1);
  expect(opens()).toHaveLength(2);
});

it.each(["cancel", "dispose"])(
  "releases a late acquired lease without native startup after %s",
  async (action) => {
    await mount();
    const pending = deferred<OwnedPtyTarget>();
    acquire.mockReturnValueOnce(pending.promise);
    const reconnect = respawnSession(1);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
    await act(async () => {
      if (action === "cancel") cancelSessionConnection(1);
      else disposeSession(1);
    });
    const late = target(8);
    pending.resolve(late);
    await vi.waitFor(() => expect(late.release).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(250);
    await reconnect;
    expect(opens()).toHaveLength(1);
    expect(writeToSession(1, "retired\r")).toBe(false);
  },
);

it("surfaces cleanup failure without acquiring a new helper and retries that exact cleanup explicitly", async () => {
  await mount();
  vi.mocked(source.release).mockRejectedValueOnce(
    new Error("helper close failed"),
  );
  await act(async () => respawnSession(1));
  await expect(waitForLeafConnection(1)).rejects.toThrow("helper close failed");
  expect(acquire).not.toHaveBeenCalled();
  expect(opens()).toHaveLength(1);
  await act(async () => respawnSession(1));
  await waitForLeafConnection(1);
  expect(source.release).toHaveBeenCalledTimes(2);
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "remote_pty_close",
    ),
  ).toHaveLength(1);
  expect(opens()).toHaveLength(2);
});

it("settles a superseded acquisition without opening it or closing the newer connection", async () => {
  await mount();
  const pending = deferred<OwnedPtyTarget>();
  const late = target(++helperId);
  acquire.mockReturnValueOnce(pending.promise);
  const old = respawnSession(1, "/srv/app/old");
  await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  const current = respawnSession(1, "/srv/app/current");
  pending.resolve(late);
  await vi.waitFor(() => expect(opens()).toHaveLength(2));
  await vi.advanceTimersByTimeAsync(250);
  await act(async () => Promise.all([old, current]));
  await waitForLeafConnection(1);
  expect(late.release).toHaveBeenCalledOnce();
  expect(opens()[1][1]).toMatchObject({
    sessionId: 9,
    cwd: "/srv/app/current",
  });
  expect(targets.get(9)?.release).not.toHaveBeenCalled();
  expect(writeToSession(1, "current\r")).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "remote_pty_write",
    expect.any(Uint8Array),
    { headers: { "x-pty-id": "92", "x-remote-session-id": "9" } },
  );
});

it("retires an initial pending native open before reconnecting the same leaf", async () => {
  const pending = deferred<number>();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command !== "remote_pty_open") return undefined;
    return opens().length === 1 ? pending.promise : 92;
  });
  await act(async () => root.render(<Leaf />));
  await vi.waitFor(() => expect(opens()).toHaveLength(1));
  const reconnect = respawnSession(1);
  pending.resolve(91);
  await vi.waitFor(() => expect(opens()).toHaveLength(2));
  await vi.advanceTimersByTimeAsync(250);
  await act(async () => reconnect);
  await waitForLeafConnection(1);
  expect(mocks.invoke).toHaveBeenCalledWith("remote_pty_close", {
    sessionId: 7,
    ptyId: 91,
  });
  expect(source.release).toHaveBeenCalledOnce();
  expect(opens()[1][1]).toMatchObject({ sessionId: 8 });
});

it("discards a cwd reply from the retired PTY after the replacement publishes its directory", async () => {
  await mount();
  const oldCwd = deferred<string>();
  mocks.invoke.mockImplementation(
    async (command: string, args: { sessionId?: number }) => {
      if (command === "remote_pty_get_cwd")
        return args.sessionId === 7 ? oldCwd.promise : "/srv/app/new";
      if (command === "remote_pty_open") return ++ptyId;
      return undefined;
    },
  );
  const oldRead = getLiveLeafCwd(1);
  await act(async () => respawnSession(1));
  expect(await getLiveLeafCwd(1)).toBe("/srv/app/new");
  oldCwd.resolve("/srv/app/old");
  expect(await oldRead).toBe("/srv/app/new");
  expect(onCwd).toHaveBeenCalledExactlyOnceWith("/srv/app/new");
});
