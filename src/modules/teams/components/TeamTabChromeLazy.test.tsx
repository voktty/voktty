// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  TeamContextMenuItemLazy,
  TeamNewTabMenuItemLazy,
  TeamTabIconLazy,
} from "@/modules/teams/components/TeamTabChromeLazy";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuItem: ({
    onSelect,
    children,
  }: {
    onSelect: () => void;
    children: ReactNode;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuItem: ({
    onSelect,
    children,
  }: {
    onSelect: () => void;
    children: ReactNode;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));
let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("loads team chrome and preserves pointed-tab and new-tab menu actions", async () => {
  const pointed = vi.fn();
  const newTab = vi.fn();
  const tab: Tab = {
    id: 1,
    ...createTabIdentity("main"),
    spaceId: "main",
    kind: "harness",
    title: "Agent",
    cwd: "/work/project",
  };
  await act(async () => {
    root.render(
      <>
        <TeamContextMenuItemLazy tab={tab} onOpen={pointed} className="" />
        <TeamNewTabMenuItemLazy onOpen={newTab} />
        <TeamTabIconLazy />
      </>,
    );
    await import("@/modules/teams/components/TeamTabChrome");
  });
  const buttons = node.querySelectorAll("button");
  expect(buttons).toHaveLength(2);
  expect(buttons[0].textContent).toBe(buttons[1].textContent);
  expect(node.querySelectorAll("svg")).toHaveLength(3);
  await act(async () => {
    buttons[0].click();
    buttons[1].click();
  });
  expect(pointed).toHaveBeenCalledExactlyOnceWith("/work/project");
  expect(newTab).toHaveBeenCalledExactlyOnceWith(expect.anything());
  // A cold import of the lazy chunk can take seconds on a loaded machine.
}, 15000);
