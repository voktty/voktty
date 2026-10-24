// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FloatingWorkspaceWidget } from "@/modules/notes-board/components/FloatingWorkspaceWidget";
import { useNotesBoardStore } from "@/modules/notes-board/store/notesBoardStore";
import { useKanbanStore } from "@/modules/notes-board/store/kanbanStore";
import { t } from "@/modules/i18n";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  vaultWrite: vi.fn(),
  notes: [
    {
      id: "note",
      slug: "example",
      title: "Example",
      body: "`echo example`",
      tags: [],
      slugPending: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  createPath: vi.fn(async () => undefined),
  writeTextFile: mocks.vaultWrite,
  listDir: vi.fn(async () => []),
}));
vi.mock("@/modules/harness/lib/notes", () => ({
  loadNotes: async () => mocks.notes,
  upsertNote: vi.fn(),
  deleteNote: vi.fn(),
  isNoteTitlePlaceholder: () => false,
}));
vi.mock("@/modules/source-control/useSourceControl", () => ({
  useSourceControl: () => ({ changedCount: 0 }),
}));
vi.mock("@/modules/notes-board/components/GitReviewTab", () => ({
  GitReviewTab: () => null,
}));
vi.mock("@/hooks/useDraggableModal", () => ({
  useDraggableModal: () => ({
    position: { x: 0, y: 0 },
    dragHandleProps: {},
    resetPosition: () => {},
    setPosition: () => {},
  }),
}));
vi.mock("@/modules/terminal", () => ({ submitToLeaf: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

let node: HTMLDivElement;
let root: Root;
let originalNotes: ReturnType<typeof useNotesBoardStore.getState>;
let originalKanban: ReturnType<typeof useKanbanStore.getState>;
const run = vi.fn(() => true);
const no = () => {};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  originalNotes = useNotesBoardStore.getState();
  originalKanban = useKanbanStore.getState();
  useNotesBoardStore.setState({ activeTab: "notes", pendingNewNote: null });
  useKanbanStore.setState({
    cards: [
      {
        id: "card",
        title: "Example card",
        description: "`echo example`",
        columnId: "todo",
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  run.mockClear();
  mocks.copy.mockClear();
  mocks.vaultWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy.mockResolvedValue(undefined) },
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  useNotesBoardStore.setState(originalNotes);
  useKanbanStore.setState(originalKanban);
  node.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(reason?: string, callback: typeof run | undefined = run) {
  await act(async () =>
    root.render(
      <FloatingWorkspaceWidget
        onClose={no}
        onRunCommand={callback}
        runCommandDisabledReason={reason}
        cwd="/project"
      />,
    ),
  );
}
function runButton() {
  const result = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === t("notesBoard.run"),
  );
  if (!result) throw new Error("Missing command action");
  return result;
}

for (const tab of ["notes", "kanban"] as const) {
  it(`keeps the ${tab} command discoverable with an accessible reason and restores it reactively`, async () => {
    useNotesBoardStore.setState({ activeTab: tab });
    await render("Unavailable terminal");
    const denied = runButton();
    expect(denied.disabled).toBe(true);
    const descriptionId = denied.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? "")?.textContent).toBe(
      "Unavailable terminal",
    );
    await act(async () => denied.click());
    expect(run).not.toHaveBeenCalled();
    await render();
    expect(runButton().disabled).toBe(false);
    expect(node.textContent).not.toContain("Unavailable terminal");
    await act(async () => runButton().click());
    expect(run).toHaveBeenCalledExactlyOnceWith("echo example");
    await render("Disconnected");
    expect(runButton().disabled).toBe(true);
    await act(async () => runButton().click());
    expect(run).toHaveBeenCalledOnce();
  });

  it(`offers a disabled ${tab} command when no runner exists`, async () => {
    useNotesBoardStore.setState({ activeTab: tab });
    await act(async () =>
      root.render(<FloatingWorkspaceWidget onClose={no} cwd="/project" />),
    );
    expect(runButton().disabled).toBe(true);
    expect(node.textContent).toContain(t("editor.terminalNoActive"));
  });
}

it("preserves note copying while execution is unavailable", async () => {
  await render("Unavailable terminal");
  const copy = node.querySelector<HTMLButtonElement>(
    `[title="${t("notesBoard.copyText")}"]`,
  );
  expect(copy?.disabled).toBe(false);
  await act(async () => copy?.click());
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("`echo example`");
  expect(run).not.toHaveBeenCalled();
});

it("exports from the widget's captured project target instead of its ambient cwd", async () => {
  useNotesBoardStore.setState({ activeTab: "kanban" });
  await act(async () => root.render(
    <FloatingWorkspaceWidget
      onClose={no}
      cwd="/ambient"
      vaultTarget={{ path: "remote://host/project", workspace: { kind: "local" } }}
      sourceKey="harness-view"
    />,
  ));
  const exportButton = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === t("notesBoard.exportVault"),
  );
  expect(exportButton?.disabled).toBe(false);
  await act(async () => exportButton?.click());
  expect(mocks.vaultWrite).toHaveBeenCalledExactlyOnceWith(
    "remote://host/project/.voktty/tasks/todo/example-card.md",
    expect.stringContaining("echo example"),
  );
});

it.each([null, { path: "/project", workspace: { kind: "serial" as const, portName: "COM1", baudRate: 9600 } }])("keeps vault actions discoverable with an accessible reason without a usable filesystem", async (target) => {
  useNotesBoardStore.setState({ activeTab: "kanban" });
  await act(async () => root.render(
    <FloatingWorkspaceWidget
      onClose={no}
      cwd="/ambient"
      vaultTarget={target}
    />,
  ));
  const buttons = [...node.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => [t("notesBoard.exportVault"), t("notesBoard.importVault")].includes(button.textContent ?? ""),
  );
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe(t("harness.unavailableDirShort"));
    await act(async () => button.click());
  }
  expect(mocks.vaultWrite).not.toHaveBeenCalled();
});
