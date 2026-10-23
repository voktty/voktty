// @vitest-environment happy-dom
import { StrictMode, act, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useTerminalSession,
  useLeafWorkspaceEnv,
  disposeSession,
  waitForLeafConnection,
  respawnSession,
  writeToSession,
  getLiveLeafCwd,
} from "@/modules/terminal/lib/useTerminalSession";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import { hydrateTabs } from "@/modules/spaces/lib/serialize";
import type { ProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), resolve: vi.fn() }));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: mocks.resolve,
}));
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
  Channel: class {
    onmessage = () => {};
  },
}));

const project = "remote://voktty-ssh-build/srv/app";
let root: Root;
let node: HTMLDivElement;
let target: ProjectTerminalTarget;
let observed: WorkspaceEnv | undefined;
function Leaf() {
  const container = useRef<HTMLDivElement>(null);
  const tab = useMemo(() => {
    let id = 100;
    return hydrateTabs(
      [
        {
          kind: "terminal",
          remoteProject: project,
          tree: { kind: "leaf", cwd: "/srv/app/src" },
        },
      ],
      "main",
      () => id++,
    )[0];
  }, []);
  if (tab.kind !== "terminal") throw new Error("Missing restored terminal.");
  useTerminalSession({
    leafId: 100,
    container,
    visible: false,
    initialCwd: tab.cwd,
    workspaceEnv: tab.workspaceEnv,
  });
  observed = useLeafWorkspaceEnv(100);
  return <div ref={container} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  target = {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/canonical/app",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    lease: {
      info: {
        session_id: 7,
        workspace_root: "/canonical/app",
        architecture: "x86_64",
        helper_version: "test",
        capabilities: [],
      },
      release: vi.fn(),
      releaseAndClose: vi.fn().mockResolvedValue(undefined),
    },
  };
  mocks.resolve.mockResolvedValue(target);
  mocks.invoke.mockImplementation(async (command) =>
    command === "remote_pty_open"
      ? 91
      : command === "remote_pty_get_cwd"
        ? "/canonical/app/src"
        : undefined,
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => {
    disposeSession(100);
    root.unmount();
  });
  await ownedPtyTargets.close(100);
  expect(ownedPtyTargets.size()).toBe(0);
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("mounts a restored leaf once under StrictMode and publishes the resolved environment to consumers", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Leaf />
      </StrictMode>,
    ),
  );
  await act(async () => waitForLeafConnection(100));
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
    project,
    undefined,
    expect.any(Function),
  );
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "remote_pty_open",
    ),
  ).toHaveLength(1);
  expect(observed).toMatchObject({
    kind: "ssh",
    sessionId: 7,
    root: "/canonical/app",
    restoredProjectCwd: project,
  });
  expect(writeToSession(100, "work\r")).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "remote_pty_write",
    expect.any(Uint8Array),
    { headers: { "x-pty-id": "91", "x-remote-session-id": "7" } },
  );
  expect(await getLiveLeafCwd(100)).toBe("/canonical/app/src");
  expect(
    mocks.invoke.mock.calls.some(
      ([command]) =>
        command === "pty_open" || command === "workspace_authorize",
    ),
  ).toBe(false);
});

it("keeps a failed profile on its original remote descriptor and retries explicitly", async () => {
  mocks.resolve.mockRejectedValue(new Error("saved profile missing"));
  await act(async () => root.render(<Leaf />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  await expect(waitForLeafConnection(100)).rejects.toThrow(
    "saved profile missing",
  );
  expect(observed).toMatchObject({ kind: "ssh", restoredProjectCwd: project });
  expect(observed).not.toHaveProperty("sessionId");
  expect(
    mocks.invoke.mock.calls.some(
      ([command]) => command === "pty_open" || command === "remote_pty_open",
    ),
  ).toBe(false);
  mocks.resolve.mockResolvedValue(target);
  await act(async () => respawnSession(100));
  await act(async () => waitForLeafConnection(100));
  expect(observed).toMatchObject({ kind: "ssh", sessionId: 7 });
});

it("closes a late project lease after the runtime is disposed without opening a PTY", async () => {
  let resolve!: (value: ProjectTerminalTarget) => void;
  mocks.resolve.mockReturnValueOnce(
    new Promise<ProjectTerminalTarget>((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(<Leaf />));
  await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
  await act(async () => {
    disposeSession(100);
    root.render(null);
  });
  resolve(target);
  await vi.waitFor(() =>
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce(),
  );
  await vi.advanceTimersByTimeAsync(250);
  expect(
    mocks.invoke.mock.calls.some(
      ([command]) => command === "remote_pty_open" || command === "pty_open",
    ),
  ).toBe(false);
});
