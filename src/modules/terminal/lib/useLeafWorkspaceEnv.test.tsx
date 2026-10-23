// @vitest-environment happy-dom
import { act, StrictMode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cancelSessionConnection,
  disposeSession,
  respawnSession,
  useLeafWorkspaceEnv,
  useTerminalSession,
  waitForLeafConnection,
} from "@/modules/terminal/lib/useTerminalSession";
import {
  ownedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useWorkspaceSwitcher } from "@/app/hooks/useWorkspaceSwitcher";

const invoke = vi.hoisted(() => vi.fn());
const activation = vi.hoisted(() => ({ open: vi.fn(), publish: vi.fn() }));
vi.mock("@/modules/remote/sessionManager", () => ({
  openHeldRemoteSession: activation.open,
  closeRemoteSessionById: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    workspaceAuthorize: vi.fn().mockResolvedValue(undefined),
    workspaceCurrentDir: async () => "/local/project",
  },
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/local/home" }));
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
  invoke,
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
const acquire = vi.fn<(cwd: string) => Promise<OwnedPtyTarget>>();
const rendered = vi.fn<(env: WorkspaceEnv | undefined) => void>();
const targets = new Map<number, OwnedPtyTarget>();
function target(id: number): OwnedPtyTarget {
  const result: OwnedPtyTarget = {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: id,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    release: vi.fn().mockResolvedValue(undefined),
    acquireSibling: acquire,
  };
  targets.set(id, result);
  return result;
}
function Leaf({
  id,
  workspace = source.workspace,
}: {
  id: number;
  workspace?: WorkspaceEnv;
}) {
  const node = useRef<HTMLDivElement>(null);
  useTerminalSession({
    leafId: id,
    container: node,
    visible: false,
    initialCwd: source.cwd,
    workspaceEnv: workspace,
  });
  return <div ref={node} />;
}
function Reader({ id }: { id: number | null }) {
  const workspace = useLeafWorkspaceEnv(id);
  rendered(workspace);
  return (
    <output>
      {workspace?.kind === "ssh"
        ? workspace.sessionId
        : (workspace?.kind ?? "none")}
    </output>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  targets.clear();
  helperId = 7;
  acquire.mockImplementation(async () => target(++helperId));
  source = target(7);
  ownedPtyTargets.register(1, source);
  let ptyId = 90;
  invoke.mockImplementation(async (command: string) =>
    command === "remote_pty_open" ? ++ptyId : undefined,
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
    disposeSession(2);
    root.unmount();
  });
  await ownedPtyTargets.close(1);
  await ownedPtyTargets.close(2);
  expect(ownedPtyTargets.size()).toBe(0);
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reads without opening a terminal or releasing its lease, including StrictMode and a missing selection", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Reader id={1} />
      </StrictMode>,
    ),
  );
  expect(container.textContent).toBe("none");
  await act(async () => root.render(<Reader id={null} />));
  expect(container.textContent).toBe("none");
  await act(async () => root.render(null));
  expect(invoke).not.toHaveBeenCalled();
  expect(acquire).not.toHaveBeenCalled();
  expect(source.release).not.toHaveBeenCalled();
});

it("publishes the copy's actual helper after the original closes without adopting its inherited descriptor", async () => {
  await act(async () =>
    root.render(
      <>
        <Leaf id={1} />
        <Leaf id={2} />
        <Reader id={2} />
      </>,
    ),
  );
  await waitForLeafConnection(2);
  await act(async () => {});
  expect(container.textContent).toBe("8");
  expect(source.workspace.sessionId).toBe(7);
  await act(async () => disposeSession(1));
  await vi.waitFor(() => expect(source.release).toHaveBeenCalledOnce());
  expect(container.textContent).toBe("8");
  expect(targets.get(8)?.release).not.toHaveBeenCalled();
  const workspace = rendered.mock.lastCall?.[0];
  expect(workspace).toMatchObject({ kind: "ssh", sessionId: 8 });
  await act(async () =>
    root.render(
      <>
        <Leaf id={2} workspace={workspace} />
        <Reader id={2} />
      </>,
    ),
  );
  expect(
    invoke.mock.calls.filter(([command]) => command === "remote_pty_open"),
  ).toHaveLength(2);
  expect(container.textContent).toBe("8");
});

it("updates after reconnect and selection changes and clears a disposed owner", async () => {
  await act(async () =>
    root.render(
      <>
        <Leaf id={1} />
        <Leaf id={2} />
        <Reader id={2} />
      </>,
    ),
  );
  await waitForLeafConnection(2);
  await act(async () => {});
  const release = deferred<void>();
  const old = targets.get(8);
  if (!old) throw new Error("Expected the copied target");
  vi.mocked(old.release).mockReturnValueOnce(release.promise);
  const reconnect = respawnSession(2);
  await vi.waitFor(() => expect(old.release).toHaveBeenCalledOnce());
  expect(container.textContent).toBe("8");
  release.resolve();
  await act(async () => reconnect);
  expect(container.textContent).toBe("9");
  await act(async () =>
    root.render(
      <>
        <Leaf id={1} />
        <Leaf id={2} />
        <Reader id={1} />
      </>,
    ),
  );
  expect(container.textContent).toBe("7");
  await act(async () => disposeSession(1));
  expect(container.textContent).toBe("none");
  await act(async () => root.render(<Reader id={2} />));
  expect(container.textContent).toBe("9");
  expect(targets.get(9)?.release).not.toHaveBeenCalled();
});

it("does not rerender a reader when another leaf reconnects", async () => {
  await act(async () =>
    root.render(
      <>
        <Leaf id={1} />
        <Leaf id={2} />
        <Reader id={2} />
      </>,
    ),
  );
  await waitForLeafConnection(2);
  await act(async () => {});
  const count = rendered.mock.calls.length;
  await act(async () => respawnSession(1));
  expect(rendered).toHaveBeenCalledTimes(count);
  expect(container.textContent).toBe("8");
});

it("never publishes a canceled late acquisition as the leaf's environment", async () => {
  const pending = deferred<OwnedPtyTarget>();
  acquire.mockReturnValueOnce(pending.promise);
  await act(async () =>
    root.render(
      <>
        <Leaf id={2} />
        <Reader id={2} />
      </>,
    ),
  );
  await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  await act(async () => cancelSessionConnection(2));
  const late = target(8);
  pending.resolve(late);
  await vi.waitFor(() => expect(late.release).toHaveBeenCalledOnce());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(
    rendered.mock.calls.some(
      ([env]) => env?.kind === "ssh" && env.sessionId === 8,
    ),
  ).toBe(false);
  expect(
    invoke.mock.calls.filter(([command]) => command === "remote_pty_open"),
  ).toHaveLength(0);
  await act(async () => disposeSession(2));
  expect(container.textContent).toBe("none");
});

it("feeds the resolved helper into the real workspace activator without reconnecting the retired inherited ID", async () => {
  function Context() {
    const workspace = useLeafWorkspaceEnv(2) ?? source.workspace;
    const controls = useWorkspaceSwitcher({
      tabsRef: { current: [] },
      workspaceEnv: source.workspace,
      setWorkspaceEnv: activation.publish,
      resetWorkspace: vi.fn(),
      clearWorkspaceState: vi.fn(),
    });
    useEffect(() => {
      void controls.activateWorkspaceEnv(workspace);
    }, [controls.activateWorkspaceEnv, workspace]);
    return null;
  }
  await act(async () =>
    root.render(
      <>
        <Leaf id={2} />
        <Context />
      </>,
    ),
  );
  await waitForLeafConnection(2);
  await vi.waitFor(() =>
    expect(activation.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "ssh", sessionId: 8 }),
    ),
  );
  await act(async () => disposeSession(1));
  await vi.waitFor(() => expect(source.release).toHaveBeenCalledOnce());
  await act(async () => respawnSession(2));
  await vi.waitFor(() =>
    expect(activation.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "ssh", sessionId: 9 }),
    ),
  );
  expect(activation.open).not.toHaveBeenCalled();
  expect(source.workspace.sessionId).toBe(7);
});
