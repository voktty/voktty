// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTabCloseGuards } from "@/app/hooks/useTabCloseGuards";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/terminal", () => ({
  leafIds: (tree: { id: number }) => [tree.id],
  leafHasKnownActivity: () => false,
  leafHasForegroundProcess: async () => false,
}));
let root: Root;
let node: HTMLDivElement;
let guards: ReturnType<typeof useTabCloseGuards>;
let previous: ReturnType<typeof useSpaces.getState>;
const dispose = vi.fn();
function terminal(
  id: number,
  projectCwd: string,
  patch: Partial<TerminalTab> = {},
): TerminalTab {
  return {
    id,
    ...createTabIdentity("main", () => String(id)),
    kind: "terminal",
    spaceId: "main",
    title: "shell",
    projectCwd,
    paneTree: { kind: "leaf", id: id + 100 },
    activeLeafId: id + 100,
    ...patch,
  };
}
function Host({ tabs }: { tabs: Tab[] }) {
  guards = useTabCloseGuards({
    tabs,
    activeId: 1,
    disposeTab: () => {},
    disposeTabs: dispose,
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  previous = useSpaces.getState();
  useSpaces.setState({ viewSpaces: [], stripEntries: [] });
  dispose.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  useSpaces.setState(previous);
  vi.unstubAllGlobals();
});

it("closes tabs to the visual right after project grouping rather than raw creation order", async () => {
  const tabs = [terminal(1, "/a"), terminal(2, "/b"), terminal(3, "/a")];
  await act(async () => root.render(<Host tabs={tabs} />));
  await act(async () => guards.handleCloseTabsToRight(3));
  expect(dispose).toHaveBeenCalledExactlyOnceWith(3, {
    closeIds: [2],
    nextActiveId: 1,
  });
});

it("preserves workspace and lock guards while using the visual order", async () => {
  const tabs = [
    terminal(1, "/a"),
    terminal(2, "/b", { locked: true }),
    terminal(3, "/a"),
    terminal(4, "/b", { spaceId: "other" }),
  ];
  await act(async () => root.render(<Host tabs={tabs} />));
  await act(async () => guards.handleCloseTabsToRight(3));
  expect(dispose).not.toHaveBeenCalled();
});

it("retains the dirty-editor confirmation when it follows a grouped terminal", async () => {
  const dirty: Tab = {
    id: 5,
    ...createTabIdentity("main", () => "editor"),
    kind: "editor",
    spaceId: "main",
    title: "file",
    path: "/a/file",
    dirty: true,
    preview: false,
  };
  const tabs = [terminal(1, "/a"), dirty, terminal(3, "/a")];
  await act(async () => root.render(<Host tabs={tabs} />));
  await act(async () => guards.handleCloseTabsToRight(3));
  expect(guards.pendingCloseMany?.plan.closeIds).toEqual([5]);
  expect(dispose).not.toHaveBeenCalled();
  await act(async () => guards.cancelCloseMany());
  expect(dispose).not.toHaveBeenCalled();
});

it("never expands a captured close selection after a later creation or reorder", async () => {
  const dirty: Tab = {
    id: 5,
    ...createTabIdentity("main", () => "editor"),
    kind: "editor",
    spaceId: "main",
    title: "file",
    path: "/a/file",
    dirty: true,
    preview: false,
  };
  const tabs = [terminal(1, "/a"), dirty, terminal(3, "/a")];
  await act(async () => root.render(<Host tabs={tabs} />));
  await act(async () => guards.handleCloseTabsToRight(3));
  expect(guards.pendingCloseMany?.plan.closeIds).toEqual([5]);
  await act(async () =>
    root.render(<Host tabs={[...tabs, terminal(6, "/b")]} />),
  );
  await act(async () => guards.confirmCloseMany());
  expect(dispose).toHaveBeenCalledExactlyOnceWith(3, {
    closeIds: [5],
    nextActiveId: 1,
  });
});
