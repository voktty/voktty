// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSurfaceTerminalCommand } from "@/modules/surfaces/lib/useSurfaceTerminalCommand";
import {
  disposeSession,
  respawnSession,
  useTerminalSession,
} from "@/modules/terminal/lib/useTerminalSession";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ open: vi.fn(), record: vi.fn() }));
vi.mock("@/modules/terminal/lib/rendererPool");
vi.mock("@/modules/terminal/lib/useTerminalFont", () => ({
  useTerminalFont: () => ({
    fontFamily: "monospace",
    fontWeight: "400",
    fontSize: 14,
  }),
}));
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({
  openPty: mocks.open,
  capturePtyReconnect: () => null,
  disposePtyTarget: vi.fn(),
  isGuestPtyTarget: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => false) }));
vi.mock("@/modules/terminal/block/lib/history", () => ({
  historyRecord: mocks.record,
}));

let root: Root;
let node: HTMLDivElement;
let pties: PtySession[];
let callbacks: PtyHandlers[];
let workspace: WorkspaceEnv;
let command: ReturnType<typeof useSurfaceTerminalCommand>;
let source: Tab | undefined;
function terminal(id = 1): Tab {
  return {
    id,
    ...createTabIdentity("main"),
    spaceId: "main",
    title: "Terminal",
    kind: "terminal",
    paneTree: { kind: "leaf", id, cwd: "/project" },
    activeLeafId: id,
  };
}
function Leaf({ visible, mounted }: { visible: boolean; mounted: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useTerminalSession({
    leafId: 1,
    container,
    visible,
    focused: visible,
    workspaceEnv: workspace,
  });
  return mounted ? <div ref={container} /> : null;
}
function Hidden() {
  const container = useRef<HTMLDivElement>(null);
  useTerminalSession({ leafId: 2, container, visible: false, focused: false });
  return <div ref={container} />;
}
function Reader() {
  command = useSurfaceTerminalCommand(source);
  return null;
}
async function render(visible = true, mounted = true) {
  await act(async () =>
    root.render(
      <>
        {mounted && <Leaf visible={visible} mounted={mounted} />}
        <Hidden />
        <Reader />
      </>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  pties = [];
  callbacks = [];
  workspace = LOCAL_WORKSPACE;
  source = terminal();
  mocks.open.mockImplementation(async (_cols, _rows, handlers: PtyHandlers) => {
    const pty: PtySession = {
      id: pties.length + 10,
      write: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    pties.push(pty);
    callbacks.push(handlers);
    return pty;
  });
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
    root.unmount();
    disposeSession(1);
    disposeSession(2);
  });
  node.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  LOCAL_WORKSPACE,
  { kind: "wsl", distro: "Debian" },
  {
    kind: "ssh",
    connection: { id: "host", name: "Host", host: "example.test" },
    root: "/project",
  },
] as WorkspaceEnv[])(
  "submits only to the ready selected terminal in $kind",
  async (env) => {
    workspace = env;
    await render();
    expect(command.disabledReason).toBeUndefined();
    expect(command.run("echo one\necho two")).toBe(true);
    expect(pties[0].write).toHaveBeenCalledExactlyOnceWith(
      "\x1b[200~echo one\necho two\x1b[201~\r",
    );
    expect(pties[1].write).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledOnce();
  },
);

it("refuses an editor or empty surface instead of using another live terminal", async () => {
  source = {
    id: 3,
    ...createTabIdentity("main"),
    spaceId: "main",
    title: "Document",
    kind: "editor",
    path: "/project/main.ts",
    dirty: false,
    preview: false,
  };
  await render();
  expect(command.disabledReason).toBe("editor.terminalNoActive");
  expect(command.run("echo wrong")).toBe(false);
  source = undefined;
  await render();
  expect(command.run("echo wrong")).toBe(false);
  expect(
    pties.every((pty) => vi.mocked(pty.write).mock.calls.length === 0),
  ).toBe(true);
});

it("allows a focused terminal slot inside Harness and retires it after hiding", async () => {
  source = {
    id: 3,
    ...createTabIdentity("main"),
    spaceId: "main",
    title: "Harness",
    kind: "harness",
    cwd: "/project",
  };
  await render();
  const cached = command.run;
  expect(cached("echo slot")).toBe(true);
  await render(false);
  expect(command.disabledReason).toBe("editor.terminalNoActive");
  await render();
  expect(cached("echo retired")).toBe(false);
  expect(command.run("echo current")).toBe(true);
  expect(pties[0].write).toHaveBeenCalledTimes(2);
  expect(pties[1].write).not.toHaveBeenCalled();
});

it("permanently retires a callback after leaving and returning to the source", async () => {
  await render();
  const original = source;
  const cached = command.run;
  source = terminal(2);
  await render();
  source = original;
  await render();
  expect(cached("echo retired")).toBe(false);
  expect(command.run("echo current")).toBe(true);
  expect(pties[1].write).not.toHaveBeenCalled();
});

it("rejects the original connection callback across reconnect and exit", async () => {
  await render();
  const cached = command.run;
  await act(async () => {
    await respawnSession(1);
  });
  expect(cached("echo old")).toBe(false);
  expect(command.run("echo new")).toBe(true);
  expect(pties[0].write).not.toHaveBeenCalled();
  expect(pties[2].write).toHaveBeenCalledExactlyOnceWith("echo new\r");
  await act(async () => callbacks[2].onExit?.(0));
  expect(command.run("echo exited")).toBe(false);
});

it("keeps dirty metadata usable but rejects detached or unmounted presentation callbacks", async () => {
  await render();
  const cached = command.run;
  if (!source) throw new Error("Missing source");
  source = { ...source, title: "Renamed" };
  await render();
  expect(cached("echo metadata")).toBe(true);
  await render(true, false);
  expect(command.run("echo detached")).toBe(false);
  await act(async () => root.unmount());
  expect(cached("echo unmounted")).toBe(false);
});

it("never queues into an opening terminal and publishes readiness after settlement", async () => {
  let finish!: (pty: PtySession) => void;
  mocks.open.mockImplementationOnce(
    () =>
      new Promise<PtySession>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  const cached = command.run;
  expect(command.disabledReason).toBe("editor.terminalNoActive");
  expect(cached("echo opening")).toBe(false);
  const pty: PtySession = {
    id: 99,
    write: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
  };
  await act(async () => finish(pty));
  expect(command.disabledReason).toBeUndefined();
  expect(cached("echo old")).toBe(false);
  expect(command.run("echo ready")).toBe(true);
  expect(pty.write).toHaveBeenCalledExactlyOnceWith("echo ready\r");
  expect(pties[0].write).not.toHaveBeenCalled();
});

it("publishes attachment after the PTY becomes ready before fonts", async () => {
  let finish!: () => void;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    },
  });
  await render();
  expect(command.disabledReason).toBe("editor.terminalNoActive");
  await act(async () => finish());
  expect(command.disabledReason).toBeUndefined();
  expect(command.run("echo attached")).toBe(true);
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("echo attached\r");
});

it("retires a cached command after a directory change and return", async () => {
  await render();
  if (source?.kind !== "terminal") throw new Error("Missing terminal source");
  const original = source;
  const cached = command.run;
  source = { ...source, paneTree: { kind: "leaf", id: 1, cwd: "/other" } };
  await render();
  source = original;
  await render();
  expect(cached("echo retired")).toBe(false);
  expect(command.run("echo current")).toBe(true);
});
