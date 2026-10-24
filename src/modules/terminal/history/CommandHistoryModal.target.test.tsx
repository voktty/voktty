// @vitest-environment happy-dom
import { act, StrictMode, useRef, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandHistoryModal } from "@/modules/terminal/history/CommandHistoryModal";
import { useCommandHistoryStore } from "@/modules/terminal/history/commandHistoryStore";
import {
  captureTerminalInputTarget,
  disposeSession,
  respawnSession,
  useTerminalSession,
} from "@/modules/terminal/lib/useTerminalSession";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  record: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  copy: vi.fn(),
}));
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
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/modules/terminal/block/lib/history", () => ({
  historyRecord: mocks.record,
  historyList: vi
    .fn()
    .mockResolvedValue([{ cmd: "echo one\necho two", count: 1, last: 1 }]),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: PropsWithChildren) => <>{children}</>,
  DialogContent: ({
    children,
    onKeyDown,
  }: PropsWithChildren<{ onKeyDown: React.KeyboardEventHandler }>) => (
    <div data-dialog onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 38,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 38,
      })),
    measureElement: () => {},
  }),
}));

let root: Root;
let node: HTMLDivElement;
let pties: PtySession[];
let handlers: PtyHandlers[];
let workspace: WorkspaceEnv;
function Leaf({
  id,
  visible = true,
  focused = true,
}: {
  id: number;
  visible?: boolean;
  focused?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useTerminalSession({
    leafId: id,
    container,
    visible,
    focused,
    workspaceEnv: workspace,
  });
  return <div ref={container} />;
}
async function render(visible = true, focused = true, mounted = true) {
  await act(async () =>
    root.render(
      <>
        {mounted && <Leaf id={1} visible={visible} focused={focused} />}
        <Leaf id={2} visible={false} focused={false} />
        <CommandHistoryModal />
      </>,
    ),
  );
}
async function open(target?: number | null) {
  await act(async () =>
    useCommandHistoryStore.getState().openHistory("", target),
  );
}
function button(key: string) {
  const found = node.querySelector<HTMLButtonElement>(
    `button[title="terminal.history.${key}"]`,
  );
  if (!found) throw new Error(`Missing ${key} button`);
  return found;
}
async function enter(shiftKey = false) {
  await act(async () =>
    node
      .querySelector("[data-dialog]")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true }),
      ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  pties = [];
  handlers = [];
  workspace = LOCAL_WORKSPACE;
  mocks.open.mockImplementation(
    async (_cols, _rows, callbacks: PtyHandlers) => {
      const pty: PtySession = {
        id: pties.length + 10,
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      pties.push(pty);
      handlers.push(callbacks);
      return pty;
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy.mockResolvedValue(undefined) },
  });
  useCommandHistoryStore.setState({
    isOpen: false,
    targetLeafId: null,
    inputTarget: null,
    searchQuery: "",
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => {
    useCommandHistoryStore.getState().closeHistory();
    root.unmount();
    disposeSession(1);
    disposeSession(2);
  });
  node.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("inserts by click and runs by keyboard on the captured visible focused terminal with multiline framing and accounting", async () => {
  await render();
  await open();
  await act(async () => button("insert").click());
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("echo one\necho two");
  expect(mocks.record).not.toHaveBeenCalled();
  expect(useCommandHistoryStore.getState().isOpen).toBe(false);
  await open(1);
  await enter(true);
  expect(pties[0].write).toHaveBeenLastCalledWith(
    "\x1b[200~echo one\necho two\x1b[201~\r",
  );
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(
    "echo one\necho two",
    undefined,
    "local",
  );
  expect(pties[1].write).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledTimes(2);
});

it.each([
  "hidden",
  "unfocused",
  "detached",
  "reconnected",
  "exited",
  "replaced",
])(
  "permanently retires the original target after it is %s, without fallback or false success",
  async (reason) => {
    await render();
    await open(1);
    const original = useCommandHistoryStore.getState().inputTarget!;
    if (reason === "hidden") {
      await render(false);
      await render();
    }
    if (reason === "unfocused") {
      await render(true, false);
      await render();
    }
    if (reason === "detached") {
      await render(true, true, false);
      await render();
    }
    if (reason === "reconnected") await act(async () => respawnSession(1));
    if (reason === "exited") await act(async () => handlers[0].onExit?.(0));
    if (reason === "replaced") {
      await render(true, true, false);
      await act(async () => disposeSession(1));
      await render();
    }
    expect(original.isAvailable()).toBe(false);
    expect(original.insert("stale")).toBe(false);
    expect(original.run("stale")).toBe(false);
    await enter();
    await enter(true);
    expect(
      pties.every((pty) => vi.mocked(pty.write).mock.calls.length === 0),
    ).toBe(true);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("editor.terminalNoActive");
    expect(useCommandHistoryStore.getState().isOpen).toBe(true);
    expect(node.querySelectorAll("button:disabled")).toHaveLength(2);
  },
);

it("keeps history searchable and copyable without a target, even if a terminal appears later", async () => {
  await render(false);
  await open();
  expect(useCommandHistoryStore.getState().inputTarget).toBeNull();
  await render();
  await enter(true);
  expect(pties[0].write).not.toHaveBeenCalled();
  await act(async () => button("copy").click());
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("echo one\necho two");
  expect(useCommandHistoryStore.getState().isOpen).toBe(true);
  expect(captureTerminalInputTarget(2)).toBeNull();
  expect(captureTerminalInputTarget(null)).toBeNull();
  await open();
  await enter();
  expect(pties[0].write).toHaveBeenCalledOnce();
});

it("runs by click only on the original resource and reports a retired callback as unavailable", async () => {
  await render();
  await open();
  await act(async () => button("run").click());
  expect(pties[0].write).toHaveBeenCalledOnce();
  await open();
  const stop = useCommandHistoryStore
    .getState()
    .inputTarget!.subscribe(() => {});
  stop();
  await act(async () => respawnSession(1));
  await enter(true);
  expect(pties[2].write).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledOnce();
});

it("does not capture or queue input while a PTY is opening", async () => {
  let resolve!: (pty: PtySession) => void;
  mocks.open.mockReturnValueOnce(
    new Promise<PtySession>((done) => {
      resolve = done;
    }),
  );
  await render();
  await open(1);
  expect(useCommandHistoryStore.getState().inputTarget).toBeNull();
  await enter(true);
  const pty: PtySession = {
    id: 90,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  await act(async () => resolve(pty));
  expect(pty.write).not.toHaveBeenCalled();
  expect(useCommandHistoryStore.getState().inputTarget).toBeNull();
  await open(1);
  await enter(true);
  expect(pty.write).toHaveBeenCalledOnce();
});

it("does not write through a reentrant reconnect during submission bookkeeping", async () => {
  await render();
  await open(1);
  let reconnect: Promise<void> | undefined;
  mocks.record.mockImplementationOnce(() => {
    reconnect = respawnSession(1);
  });
  await enter(true);
  await act(async () => reconnect);
  expect(
    pties.every((pty) => vi.mocked(pty.write).mock.calls.length === 0),
  ).toBe(true);
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("editor.terminalNoActive");
});

it("admits the current StrictMode presentation and retires it on unmount", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Leaf id={1} />
      </StrictMode>,
    ),
  );
  const target = captureTerminalInputTarget(1)!;
  expect(target.insert("current")).toBe(true);
  await act(async () => root.render(null));
  expect(target.insert("retired")).toBe(false);
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("current");
});

it.each<WorkspaceEnv>([
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    root: "/srv/app",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
])(
  "preserves $kind accounting and input ownership independently of the outer surface",
  async (env) => {
    workspace = env;
    await render();
    await open();
    await enter(true);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(
      "echo one\necho two",
      "unix",
      env.kind,
    );
    expect(pties[0].write).toHaveBeenCalledOnce();
    expect(pties[1].write).not.toHaveBeenCalled();
  },
);
