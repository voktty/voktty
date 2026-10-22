// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newTab } from "@/modules/harness/lib/layout";
import { newSession } from "@/modules/harness/lib/session";
import {
  setWorktreeFocus,
  worktreeFocus,
} from "@/modules/harness/lib/worktreeFocus";
import { useWorkspaceNavigation } from "@/modules/harness/hooks/useWorkspaceNavigation";

const project = "/work/admission-project";
let root: Root;
let host: HTMLDivElement;
let navigation: ReturnType<typeof useWorkspaceNavigation>;
const activate = vi.fn();
const pins = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorktreeFocus(project, undefined);
  pins.clear();
  activate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(accepted: boolean) {
  const session = newSession("cursor", project);
  const tab = newTab(session.id);
  const move = vi.fn(async () => accepted);
  function View() {
    const value = useWorkspaceNavigation({
      project,
      activeTabId: tab.id,
      tabs: [tab],
      sessions: [session],
      pins,
      tabWorkspace: () => project,
      moveSession: move,
      activateTab: activate,
      createTab: () => "created",
    });
    useEffect(() => {
      navigation = value;
    });
    return null;
  }
  await act(async () => root.render(<View />));
  await act(async () =>
    navigation.selectWorkspace(project, {
      path: "/work/target",
      branch: "target",
    }),
  );
  return { move, tab };
}

it("does not publish workspace focus or pins when move admission is denied", async () => {
  const { move, tab } = await mount(false);
  expect(move).toHaveBeenCalledOnce();
  expect(worktreeFocus(project)).toBeUndefined();
  expect(pins.get(tab.id)).toBe(project);
  expect(activate).not.toHaveBeenCalled();
  expect(navigation.pending).toBeNull();
});

it("publishes the workspace after a successful admitted move", async () => {
  const { move, tab } = await mount(true);
  expect(move).toHaveBeenCalledOnce();
  expect(worktreeFocus(project)?.path).toBe("/work/target");
  expect(pins.get(tab.id)).toBe("/work/target");
  expect(activate).toHaveBeenCalledExactlyOnceWith(tab.id);
});
