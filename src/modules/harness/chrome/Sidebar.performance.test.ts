// @vitest-environment happy-dom

import { Sidebar } from "@/modules/harness/chrome/Sidebar";
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
