// @vitest-environment happy-dom

import { Sidebar } from "@/modules/harness/chrome/Sidebar";
import { t } from "@/modules/i18n";
import { act, type ComponentProps, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@/modules/harness/lib/clipboard", () => ({
  copyText: vi.fn(),
  messageFilesFromClipboard: vi.fn(() => null),
}));
vi.mock("@/modules/harness/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => new Map(),
}));
vi.mock("@/modules/harness/hooks/useInboxUnseen", () => ({
  useInboxUnseen: () => 0,
}));
vi.mock("@/modules/harness/chrome/FileTree", () => ({
  FileTree: ({ cwd }: { cwd: string }) =>
    createElement("div", { "data-explorer-cwd": cwd }),
}));
vi.mock("@/modules/harness/chrome/ProjectRail", () => ({
  ProjectRail: () => createElement("input", { "data-project-rail": true }),
}));
vi.mock("@/modules/harness/chrome/SourceControl", () => ({
  SourceControl: () => createElement("div", { "data-copied-source-control": true }),
}));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    cwd: "C:/workspace/project",
    open: true,
    layout: "classic",
    status: "idle",
    pending: false,
    tab: "sessions",
    onTabChange: vi.fn(),
    filesSearchOpen: false,
    onFilesSearchOpenChange: vi.fn(),
    onOpenFile: vi.fn(),
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    sessions: [],
    activeSessionId: undefined,
    onSelectSession: vi.fn(),
    onNew: vi.fn(),
    onPinSession: vi.fn(),
    onRenameSession: vi.fn(),
    onArchiveSession: vi.fn(),
    onDeleteSession: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = () => act(() => root.render(createElement(Sidebar, props)));
const explorer = () =>
  container.querySelector<HTMLElement>("[data-explorer-cwd]");

it("does not mount an explorer while browsing chats", () => {
  render();
  expect(explorer()).toBeNull();
  props = { ...props, cwd: "C:/workspace/second" };
  render();
  expect(explorer()).toBeNull();
});
it("retains the hidden explorer until Files opens the next project", () => {
  props = { ...props, tab: "files" };
  render();
  const first = explorer();
  if (!first) throw new Error("Explorer did not mount");
  first.scrollTop = 73;
  props = { ...props, tab: "sessions", cwd: "C:/workspace/second" };
  render();
  expect(explorer()).toBe(first);
  expect(first.scrollTop).toBe(73);
  props = { ...props, tab: "files" };
  render();
  expect(explorer()).not.toBe(first);
  expect(explorer()?.dataset.explorerCwd).toBe(props.cwd);
});
it("updates the visible explorer immediately on project changes", () => {
  props = { ...props, tab: "files" };
  render();
  props = { ...props, cwd: "C:/workspace/second" };
  render();
  expect(explorer()?.dataset.explorerCwd).toBe(props.cwd);
});

it.each(["classic", "deck"] as const)(
  "retains session rows while the %s column is hidden and restored",
  (layout) => {
    props = {
      ...props,
      layout,
      sessions: [{
        id: "retained-session",
        cwd: props.cwd,
        harness: "claude",
        model: "claude-model",
        runtimeMode: "supervised",
        title: "Retained conversation",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
    };
    render();
    const row = container.querySelector('[data-session-card="retained-session"]');
    expect(row).not.toBeNull();
    const column = row?.closest("aside")?.parentElement;
    props = { ...props, open: false };
    render();
    expect(container.querySelector('[data-session-card="retained-session"]')).toBe(row);
    expect(column?.getAttribute("aria-hidden")).toBe("true");
    expect(column?.hasAttribute("inert")).toBe(true);
    expect(column?.className).toBe("hidden");
    props = { ...props, open: true };
    render();
    expect(container.querySelector('[data-session-card="retained-session"]')).toBe(row);
    expect(column?.getAttribute("aria-hidden")).toBe("false");
  },
);

it("retains the project rail and its input state through focus visibility changes", () => {
  props = {
    ...props,
    layout: "deck",
    onSelectProject: vi.fn(),
    onOpenProject: vi.fn(),
    projectRailOpen: true,
  };
  render();
  const rail = container.querySelector<HTMLInputElement>("[data-project-rail]");
  if (!rail) throw new Error("Project rail did not mount");
  rail.value = "remote picker state";
  props = { ...props, open: false, projectRailOpen: false };
  render();
  expect(container.querySelector("[data-project-rail]")).toBe(rail);
  expect(rail.parentElement?.getAttribute("aria-hidden")).toBe("true");
  props = { ...props, open: true, projectRailOpen: true };
  render();
  expect(container.querySelector("[data-project-rail]")).toBe(rail);
  expect(rail.value).toBe("remote picker state");
});

it("replaces the legacy changes tab with a button to the owning Git target", () => {
  const showSourceControl = vi.fn();
  props = {
    ...props,
    layout: "deck",
    tab: "changes",
    gitCwd: "C:/workspace/project-worktree",
    onShowSourceControl: showSourceControl,
  };
  render();
  expect(props.onTabChange).toHaveBeenCalledWith("sessions");
  expect(container.querySelector("[data-copied-source-control]")).toBeNull();
  expect([...container.querySelectorAll('[role="tab"]')].some((tab) =>
    tab.getAttribute("aria-label")?.includes(t("harness.chrome.changes")),
  )).toBe(false);
  const shortcut = container.querySelector<HTMLButtonElement>(`button[title="${t("harness.chrome.changes")}"]`);
  if (!shortcut) throw new Error("Git shortcut did not mount");
  act(() => shortcut.click());
  expect(showSourceControl).toHaveBeenCalledOnce();
  expect(props.onTabChange).not.toHaveBeenCalledWith("changes");
});
