// @vitest-environment happy-dom
import {
  act,
  StrictMode,
  useRef,
  type PropsWithChildren,
  type ComponentProps,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  captureTerminalSubmissionTarget,
  captureTerminalInputTarget,
  disposeSession,
  respawnSession,
  useTerminalSession,
} from "@/modules/terminal/lib/useTerminalSession";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";
import { useAgentHandoffTargets } from "./useAgentHandoffTargets";
import { NotesTab } from "@/modules/notes-board/components/NotesTab";
import { KanbanTab } from "@/modules/notes-board/components/KanbanTab";
import { useKanbanStore } from "@/modules/notes-board/store/kanbanStore";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  record: vi.fn(),
  success: vi.fn(),
  guest: false,
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
  isGuestPtyTarget: () => mocks.guest,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/modules/terminal/block/lib/history", () => ({
  historyRecord: mocks.record,
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/modules/harness/lib/notes", () => ({
  loadNotes: async () => [
    {
      id: "note",
      title: "Example",
      body: "`echo task`",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  isNoteTitlePlaceholder: () => false,
  upsertNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: (props: ComponentProps<"button">) => (
    <button type="button" data-handoff {...props} />
  ),
}));
const tabs = [{ id: 7, kind: "terminal", activeLeafId: 1, title: "Chosen" }];
let root: Root;
let node: HTMLDivElement;
let pties: PtySession[];
let handlers: PtyHandlers[];
let workspace: WorkspaceEnv;
let targets: ReturnType<typeof useAgentHandoffTargets>;
let originalCards: ReturnType<typeof useKanbanStore.getState>;
let originalAgents: ReturnType<typeof useAgentStore.getState>;
const activate = vi.fn();
function Leaf({
  id,
  visible = false,
  focused = false,
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
function Probe() {
  targets = useAgentHandoffTargets(tabs);
  return null;
}
async function render(
  surface: "probe" | "notes" | "kanban" = "probe",
  visible = false,
) {
  await act(async () =>
    root.render(
      <>
        <Leaf id={1} visible={visible} focused={visible} />
        <Leaf id={2} visible focused />
        {surface === "notes" ? (
          <NotesTab tabs={tabs} onActivateAgent={activate} />
        ) : surface === "kanban" ? (
          <KanbanTab tabs={tabs} onActivateAgent={activate} />
        ) : (
          <Probe />
        )}
      </>,
    ),
  );
}
function button(index = 0) {
  const result =
    node.querySelectorAll<HTMLButtonElement>("[data-handoff]")[index];
  if (!result) throw new Error("Missing handoff action");
  return result;
}
function exitFirstTerminal() {
  const onExit = handlers[0].onExit;
  if (!onExit) throw new Error("Missing terminal exit callback");
  onExit(0);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.guest = false;
  pties = [];
  handlers = [];
  workspace = LOCAL_WORKSPACE;
  originalCards = useKanbanStore.getState();
  originalAgents = useAgentStore.getState();
  useAgentStore.setState({ sessions: {} });
  useKanbanStore.setState({
    cards: [
      {
        id: "card",
        title: "Task",
        description: "Details",
        columnId: "todo",
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
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
  useKanbanStore.setState(originalCards);
  useAgentStore.setState(originalAgents);
  node.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does not open resources for an absent target, including StrictMode", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    ),
  );
  expect(targets[0].submission).toBeNull();
  expect(targets[0].run("echo task")).toBe(false);
  expect(captureTerminalSubmissionTarget(99)).toBeNull();
  expect(mocks.open).not.toHaveBeenCalled();
});

it("admits the exact hidden terminal independently of the focused input target", async () => {
  await render();
  expect(captureTerminalInputTarget(1)).toBeNull();
  expect(targets[0].run("echo one\necho two")).toBe(true);
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith(
    "\x1b[200~echo one\necho two\x1b[201~\r",
  );
  expect(pties[1].write).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledOnce();
});

it("preserves explicit submission through visibility and focus changes", async () => {
  await render();
  const old = captureTerminalSubmissionTarget(1);
  await render("probe", true);
  await render();
  expect(old?.run("echo task")).toBe(true);
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("echo task\r");
});

it("retires a capture permanently across same-leaf reconnect", async () => {
  await render();
  const old = targets[0];
  await act(async () => respawnSession(1));
  expect(old.run("old")).toBe(false);
  expect(old.submission?.isAvailable()).toBe(false);
  expect(targets[0].run("fresh")).toBe(true);
  expect(pties[0].write).not.toHaveBeenCalled();
  expect(pties[2].write).toHaveBeenCalledExactlyOnceWith("fresh\r");
});

it("retires disposal, exit and remount without writing to a successor", async () => {
  await render();
  const old = captureTerminalSubmissionTarget(1);
  await act(async () => exitFirstTerminal());
  expect(old?.run("exited")).toBe(false);
  expect(targets[0].submission).toBeNull();
  await act(async () => {
    root.render(null);
    disposeSession(1);
    disposeSession(2);
  });
  await render();
  expect(old?.run("replacement")).toBe(false);
  expect(pties[2].write).not.toHaveBeenCalled();
});

it("rejects an opening terminal and publishes availability only after its own startup", async () => {
  let resolve!: (pty: PtySession) => void;
  mocks.open.mockImplementationOnce(
    () =>
      new Promise<PtySession>((res) => {
        resolve = res;
      }),
  );
  await render();
  expect(targets[0].submission).toBeNull();
  expect(targets[0].run("early")).toBe(false);
  const pty: PtySession = {
    id: 30,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  await act(async () => resolve(pty));
  expect(targets[0].run("ready")).toBe(true);
  expect(pty.write).toHaveBeenCalledExactlyOnceWith("ready\r");
});

it("never exposes collaboration guests as submission targets", async () => {
  mocks.guest = true;
  await render();
  expect(captureTerminalSubmissionTarget(1)).toBeNull();
  expect(targets[0].submission).toBeNull();
  expect(targets[0].run("task")).toBe(false);
  expect(pties[0].write).not.toHaveBeenCalled();
});

it("revalidates resource identity after reentrant history bookkeeping", async () => {
  await render();
  const old = targets[0];
  mocks.record.mockImplementationOnce(() => disposeSession(1));
  await act(async () => expect(old.run("retired")).toBe(false));
  expect(pties[0].write).not.toHaveBeenCalled();
  expect(pties[1].write).not.toHaveBeenCalled();
});

it("retires cached menu callbacks after their owner unmounts", async () => {
  await render();
  const old = targets[0];
  await act(async () => root.render(null));
  expect(old.run("retired")).toBe(false);
  expect(pties[0].write).not.toHaveBeenCalled();
});

for (const surface of ["notes", "kanban"] as const) {
  it(`submits the ${surface} action to its chosen hidden terminal before activation`, async () => {
    await render(surface);
    expect(button().disabled).toBe(false);
    await act(async () => button().click());
    expect(pties[0].write).toHaveBeenCalledOnce();
    expect(pties[1].write).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledExactlyOnceWith(7, 1);
    if (surface === "notes") expect(mocks.success).toHaveBeenCalledOnce();
    else
      expect(useKanbanStore.getState().cards[0]).toMatchObject({
        columnId: "in_progress",
        assignedExecution: { leafId: 1, tabId: 7 },
      });
  });
  it(`keeps ${surface} unavailable targets visible and disables delivery after exit`, async () => {
    await render(surface);
    await act(async () => exitFirstTerminal());
    expect(button().disabled).toBe(true);
    expect(button().title).toBeTruthy();
    await act(async () => button().click());
    expect(pties[0].write).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(
      useKanbanStore.getState().cards[0].assignedExecution,
    ).toBeUndefined();
  });
  it(`suppresses ${surface} success and assignment when reentrancy rejects admission`, async () => {
    await render(surface);
    mocks.record.mockImplementationOnce(() => disposeSession(1));
    await act(async () => button().click());
    expect(pties[0].write).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(
      useKanbanStore.getState().cards[0].assignedExecution,
    ).toBeUndefined();
  });
}

it("keeps Notes' command-only action under the same captured admission", async () => {
  await render("notes");
  await act(async () => button(1).click());
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("echo task\r");
  expect(mocks.success).toHaveBeenCalledOnce();
});

it("preserves the selected SSH resource and command history transport", async () => {
  workspace = {
    kind: "ssh",
    root: "/project",
    sessionId: 7,
    connection: { id: "host", name: "Host", host: "example.invalid" },
  };
  await render();
  expect(targets[0].run("task")).toBe(true);
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith("task", "unix", "ssh");
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("task\r");
  expect(pties[1].write).not.toHaveBeenCalled();
});

it("retires an older menu publication when agent metadata changes and returns", async () => {
  await render();
  const old = targets[0];
  await act(async () =>
    useAgentStore.setState({
      sessions: {
        1: {
          leafId: 1,
          tabId: 7,
          agent: "codex",
          status: "working",
          startedAt: 1,
          lastActivityAt: 1,
          attentionSince: null,
        },
      },
    }),
  );
  expect(old.run("old metadata")).toBe(false);
  expect(targets[0].displayName).toBe("Codex");
  await act(async () => useAgentStore.setState({ sessions: {} }));
  expect(old.run("returned metadata")).toBe(false);
  expect(targets[0].run("fresh metadata")).toBe(true);
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("fresh metadata\r");
});

it("retains its published snapshot when only an unrelated terminal reconnects", async () => {
  await render();
  const original = targets;
  await act(async () => respawnSession(2));
  expect(targets).toBe(original);
  expect(targets[0].run("chosen")).toBe(true);
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("chosen\r");
  expect(pties[2].write).not.toHaveBeenCalled();
});
