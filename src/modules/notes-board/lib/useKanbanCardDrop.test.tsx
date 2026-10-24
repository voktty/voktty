// @vitest-environment happy-dom
import { act, StrictMode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useKanbanCardDrop } from "./useKanbanCardDrop";
import { useKanbanStore } from "@/modules/notes-board/store/kanbanStore";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { TabBar } from "@/modules/tabs/TabBar";
import { VerticalTabBar } from "@/modules/tabs/VerticalTabBar";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import {
  captureTerminalSubmissionTarget,
  disposeSession,
  useTerminalSession,
} from "@/modules/terminal/lib/useTerminalSession";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";
import { LOCAL_WORKSPACE } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  record: vi.fn(),
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
vi.mock("@/modules/tabs/NewTabMenu", () => ({ NewTabMenu: () => null }));

const activate = vi.fn();
const no = () => {};
function terminal(id = 7, leaf = 1): TerminalTab {
  return {
    ...createTabIdentity("main", () => String(id)),
    id,
    spaceId: "main",
    kind: "terminal",
    title: `Terminal ${id}`,
    cwd: "/project",
    paneTree: { kind: "leaf", id: leaf },
    activeLeafId: leaf,
  };
}
function Leaf({ id }: { id: number }) {
  const container = useRef<HTMLDivElement>(null);
  useTerminalSession({
    leafId: id,
    container,
    visible: id === 2,
    focused: id === 2,
    workspaceEnv: LOCAL_WORKSPACE,
  });
  return <div ref={container} />;
}
let drop: ReturnType<typeof useKanbanCardDrop>;
function Surface({
  tabs,
  direction,
  focus = activate,
}: {
  tabs: Tab[];
  direction?: "horizontal" | "vertical";
  focus?: typeof activate;
}) {
  drop = useKanbanCardDrop(tabs, focus);
  const common = {
    tabs,
    activeId: 8,
    onSelect: no,
    onClose: no,
    onDuplicate: no,
    onPin: no,
    onRename: no,
    onReorder: no,
    onCardDrop: drop,
    stripEntries: tabs.map((tab) => ({
      kind: "standalone" as const,
      tabKey: tab.tabKey,
    })),
    viewSpaces: [],
  };
  return direction === "horizontal" ? (
    <TabBar
      {...common}
      onNew={no}
      onNewBlock={no}
      onNewPrivate={no}
      onNewEditor={no}
      onLaunchAgents={no}
      onCloseTabsToRight={no}
      onCloseOtherTabs={no}
    />
  ) : direction === "vertical" ? (
    <VerticalTabBar {...common} />
  ) : null;
}
let root: Root;
let node: HTMLDivElement;
let pties: PtySession[];
let handlers: PtyHandlers[];
let originalCards: ReturnType<typeof useKanbanStore.getState>;
let originalAgents: ReturnType<typeof useAgentStore.getState>;
async function render(
  tabs: Tab[],
  direction?: "horizontal" | "vertical",
  focus = activate,
) {
  await act(async () =>
    root.render(
      <>
        <Leaf id={1} />
        <Leaf id={2} />
        <Surface tabs={tabs} direction={direction} focus={focus} />
      </>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(no);
  mocks.guest = false;
  pties = [];
  handlers = [];
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
  mocks.open.mockImplementation(async (_cols, _rows, callback: PtyHandlers) => {
    const pty: PtySession = {
      id: pties.length + 10,
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    pties.push(pty);
    handlers.push(callback);
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
  useKanbanStore.setState(originalCards);
  useAgentStore.setState(originalAgents);
  node.remove();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function expectDenied() {
  expect(
    pties.every((pty) => vi.mocked(pty.write).mock.calls.length === 0),
  ).toBe(true);
  expect(useKanbanStore.getState().cards[0]?.assignedExecution).toBeUndefined();
  expect(activate).not.toHaveBeenCalled();
}

it.each(["horizontal", "vertical"] as const)(
  "routes a real %s card drop to the pointed hidden terminal",
  async (direction) => {
    const source = terminal();
    await render([source, terminal(8, 2)], direction);
    const row = node.querySelector('[data-tab-id="7"]');
    if (!row) throw new Error("Missing pointed tab");
    const values: Record<string, string> = {
      "application/voktty-card-id": "card",
      "application/voktty-card-prompt": "first\nsecond",
    };
    await act(async () => {
      for (const type of ["dragover", "drop"]) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", {
          value: {
            types: Object.keys(values),
            getData: (key: string) => values[key] ?? "",
            dropEffect: "none",
          },
        });
        row.dispatchEvent(event);
      }
    });
    expect(pties[0].write).toHaveBeenCalledExactlyOnceWith(
      "\x1b[200~first\nsecond\x1b[201~\r",
    );
    expect(pties[1].write).not.toHaveBeenCalled();
    expect(useKanbanStore.getState().cards[0]).toMatchObject({
      columnId: "in_progress",
      assignedExecution: { leafId: 1, tabId: 7 },
    });
    expect(activate).toHaveBeenCalledExactlyOnceWith(7, 1);
  },
);

it.each(["tabKey", "leaf", "space", "cwd", "workspace"] as const)(
  "permanently retires the old tab input after its %s changes and returns",
  async (change) => {
    const source = terminal();
    await render([source]);
    const changed: TerminalTab =
      change === "tabKey"
        ? { ...source, ...createTabIdentity("main", () => "new") }
        : change === "leaf"
          ? { ...source, activeLeafId: 2, paneTree: { kind: "leaf", id: 2 } }
          : change === "space"
            ? { ...source, spaceId: "other" }
            : change === "cwd"
              ? { ...source, cwd: "/other" }
              : { ...source, workspaceEnv: { kind: "wsl", distro: "Test" } };
    await render([changed]);
    expect(drop(source, "card", "old")).toBe(false);
    await render([{ ...source }]);
    expect(drop(source, "card", "returned")).toBe(false);
    expectDenied();
  },
);

it("preserves admission for unchanged resource identity through label updates", async () => {
  const source = terminal();
  await render([source]);
  await render([{ ...source, customTitle: "Renamed", color: "red" }]);
  await act(async () =>
    expect(drop(source, "card", "original payload")).toBe(true),
  );
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("original payload\r");
});

it("rejects closed, foreign, nonterminal and guest tab descriptors", async () => {
  const source = terminal();
  await render([source]);
  expect(drop(terminal(9, 1), "card", "foreign")).toBe(false);
  await render([]);
  expect(drop(source, "card", "closed")).toBe(false);
  const editor: Tab = {
    ...createTabIdentity("main"),
    id: 9,
    spaceId: "main",
    kind: "editor",
    title: "File",
    path: "/file",
    preview: false,
    dirty: false,
  };
  const guest: TerminalTab = {
    ...terminal(),
    collaboration: { mode: "guest" },
  };
  await render([editor, guest]);
  expect(drop(editor, "card", "editor")).toBe(false);
  expect(drop(guest, "card", "guest")).toBe(false);
  expectDenied();
});

it("requires an existing card and bounded nonempty text before bookkeeping", async () => {
  const source = terminal();
  await render([source]);
  for (const [id, text] of [
    ["missing", "task"],
    ["card", " "],
    ["card", "\0"],
    ["card", "x".repeat(1024 * 1024 + 1)],
    ["x".repeat(257), "task"],
  ])
    expect(drop(source, id, text)).toBe(false);
  expect(mocks.record).not.toHaveBeenCalled();
  expectDenied();
});

it("rejects an opening or exited terminal without assigning its card", async () => {
  let resolve!: (pty: PtySession) => void;
  mocks.open.mockImplementationOnce(
    () =>
      new Promise<PtySession>((res) => {
        resolve = res;
      }),
  );
  const source = terminal();
  await render([source]);
  expect(drop(source, "card", "opening")).toBe(false);
  expectDenied();
  const pty: PtySession = {
    id: 30,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  await act(async () => resolve(pty));
  await act(async () => disposeSession(1));
  expect(drop(source, "card", "disposed")).toBe(false);
  expect(pty.write).not.toHaveBeenCalled();
  expectDenied();
});

it("retires an old handler when its activation callback changes and returns", async () => {
  const source = terminal();
  await render([source]);
  const old = drop;
  await render([source], undefined, vi.fn());
  await render([source]);
  expect(old(source, "card", "old callback")).toBe(false);
  expectDenied();
});

it("rejects a cached handler after unmount without opening or writing", async () => {
  const source = terminal();
  await render([source]);
  const old = drop;
  await act(async () => root.render(null));
  expect(old(source, "card", "unmounted")).toBe(false);
  expectDenied();
});

it("starts no work during a StrictMode mount", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Surface tabs={[terminal()]} />
      </StrictMode>,
    ),
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(activate).not.toHaveBeenCalled();
});

it("withdraws caller authority between history bookkeeping and the actual PTY write", async () => {
  const source = terminal();
  await render([source]);
  mocks.record.mockImplementationOnce(() =>
    useKanbanStore.getState().deleteCard("card"),
  );
  await act(async () =>
    expect(drop(source, "card", "retired card")).toBe(false),
  );
  expectDenied();
});

it("revalidates a changed pointed descriptor between bookkeeping and writing", async () => {
  const source = terminal();
  await render([source]);
  mocks.record.mockImplementationOnce(() => {
    source.activeLeafId = 2;
  });
  await act(async () =>
    expect(drop(source, "card", "retired leaf")).toBe(false),
  );
  expectDenied();
});

it("suppresses activation if assignment observers close the captured terminal", async () => {
  const source = terminal();
  await render([source]);
  const unsubscribe = useKanbanStore.subscribe((state) => {
    if (state.cards[0]?.assignedExecution) disposeSession(1);
  });
  try {
    await act(async () => expect(drop(source, "card", "accepted")).toBe(true));
  } finally {
    unsubscribe();
  }
  expect(pties[0].write).toHaveBeenCalledExactlyOnceWith("accepted\r");
  expect(activate).not.toHaveBeenCalled();
});

it("carries the detected agent name and status only after admitted submission", async () => {
  const source = terminal();
  await render([source]);
  await act(async () =>
    useAgentStore.setState({
      sessions: {
        1: {
          leafId: 1,
          tabId: 7,
          agent: "codex",
          status: "waiting",
          startedAt: 1,
          lastActivityAt: 1,
          attentionSince: 1,
        },
      },
    }),
  );
  await act(async () => expect(drop(source, "card", "task")).toBe(true));
  expect(useKanbanStore.getState().cards[0].assignedExecution).toMatchObject({
    agentName: "Codex",
    lastObservedStatus: "waiting",
  });
});

it("retains optional caller guards at both submission admission and actual write", async () => {
  const source = terminal();
  await render([source]);
  const target = captureTerminalSubmissionTarget(1);
  expect(target?.run("denied", () => false)).toBe(false);
  expect(mocks.record).not.toHaveBeenCalled();
  let current = true;
  mocks.record.mockImplementationOnce(() => {
    current = false;
  });
  expect(target?.run("retired", () => current)).toBe(false);
  expectDenied();
});
