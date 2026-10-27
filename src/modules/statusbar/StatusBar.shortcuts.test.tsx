// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StatusBar } from "@/modules/statusbar/StatusBar";
import { useNotesBoardStore } from "@/modules/notes-board/store/notesBoardStore";
import { useGlobalShortcuts } from "@/modules/shortcuts/lib/useGlobalShortcuts";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";

vi.mock("@/modules/ai", () => ({
  useChatStore: (select: (state: unknown) => unknown) =>
    select({
      panelOpen: false,
      mini: { open: false, collapsed: false },
      unreadCount: 0,
    }),
}));
vi.mock("@/modules/ai/components/AgentStatusPill", () => ({
  AgentStatusPill: () => null,
}));
vi.mock("@/modules/ai/components/AiStatusBarControls", () => ({
  AiOpenButton: () => null,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (state: unknown) => unknown) =>
    select({
      shortcuts: { "pane.splitDown": [{ ctrl: true, alt: true, key: "d" }] },
    }),
}));
vi.mock("@/modules/header", () => ({ SearchInline: () => null }));
vi.mock("@/modules/docker", () => ({ DockerControlPill: () => null }));
vi.mock("@/modules/lsp", () => ({ LspStatusPill: () => null }));
vi.mock("@/modules/preview", () => ({ DevServerPill: () => null }));
vi.mock("@/modules/serial", () => ({ SerialControlPill: () => null }));
vi.mock("@/modules/statusbar/CwdBreadcrumb", () => ({
  CwdBreadcrumb: () => null,
}));
vi.mock("@/modules/statusbar/DiagnosticsBadge", () => ({
  DiagnosticsBadge: () => null,
}));
vi.mock("@/modules/statusbar/EditorStatus", () => ({
  EditorStatus: () => null,
}));
vi.mock("@/modules/statusbar/WorkspaceEnvSelector", () => ({
  WorkspaceEnvSelector: () => null,
}));
vi.mock("@/modules/statusbar/components/ConsoleUptimeWidget", () => ({
  ConsoleUptimeWidget: () => null,
}));
vi.mock("@/modules/statusbar/components/ProjectToolkitPopover", () => ({
  ProjectToolkitPopover: () => null,
}));
vi.mock("@/modules/notes-board/components/FloatingWorkspaceWidget", () => ({
  FloatingWorkspaceWidget: () => null,
}));

const noop = () => {};
const props: Parameters<typeof StatusBar>[0] = {
  onCd: noop,
  onWorkspaceChange: noop,
  onToggleAi: noop,
  onOpenAi: noop,
  onOpenSettings: noop,
  onOpenDevServer: noop,
  searchTarget: null,
  searchRef: createRef(),
  hasComposer: false,
  privateActive: false,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useNotesBoardStore.setState({ isOpen: false, activeTab: "notes" });
  publishActiveSurface({ kind: "terminal", ownerId: 1, cwd: "/project" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useNotesBoardStore.setState({ isOpen: false, activeTab: "notes" });
  publishActiveSurface(null);
  vi.unstubAllGlobals();
});

it("dispatches the terminal split without also opening Git Review", async () => {
  const split = vi.fn();
  function Desktop() {
    useGlobalShortcuts({ "pane.splitDown": split });
    return <StatusBar {...props} />;
  }
  await act(async () => root.render(<Desktop />));
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        ctrlKey: true,
        altKey: true,
        cancelable: true,
      }),
    ),
  );
  expect(split).toHaveBeenCalledOnce();
  expect(useNotesBoardStore.getState().isOpen).toBe(false);
});

it("opens Git Review with its advertised Alt+D shortcut", async () => {
  await act(async () => root.render(<StatusBar {...props} />));
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        altKey: true,
        cancelable: true,
      }),
    ),
  );
  expect(useNotesBoardStore.getState()).toMatchObject({
    isOpen: true,
    activeTab: "review",
  });
});

it.each([
  { metaKey: true },
  { shiftKey: true },
  { isComposing: true },
  { consumed: true },
])(
  "does not open Git Review for a modified or consumed shortcut: %j",
  async ({ consumed, ...modifiers }) => {
    await act(async () => root.render(<StatusBar {...props} />));
    const event = new KeyboardEvent("keydown", {
      key: "d",
      altKey: true,
      cancelable: true,
      ...modifiers,
    });
    if (consumed) event.preventDefault();
    await act(async () => window.dispatchEvent(event));
    expect(useNotesBoardStore.getState().isOpen).toBe(false);
  },
);
