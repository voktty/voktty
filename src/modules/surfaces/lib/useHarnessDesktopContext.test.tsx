// @vitest-environment happy-dom
import { act, StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { useWorkspaceCwd } from "@/modules/tabs/lib/useWorkspaceCwd";
import { useHarnessDesktopContext } from "@/modules/surfaces/lib/useHarnessDesktopContext";
import { publishHarnessFocusFolder, publishHarnessProject, useHarnessSurfaceStore } from "@/modules/surfaces/lib/harnessSurfaceStore";
import { subscribeHarnessProjectRequests } from "@/modules/surfaces/lib/harnessProjectRequest";

afterEach(() => {
  useHarnessSurfaceStore.setState({ reports: {} });
  vi.unstubAllGlobals();
});

const harness = (id: number, cwd?: string) => ({ id, kind: "harness", tabKey: asTabKey(`tab-${id}`), spaceId: "s", title: "Harness", cwd }) as Tab;

it("projects only the selected owner into Explorer and canonical project metadata under StrictMode", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let result: ReturnType<typeof useHarnessDesktopContext> | undefined;
  let explorer: ReturnType<typeof useWorkspaceCwd> | undefined;
  let live: Tab[] = [];
  let renders = 0;
  let changeCwd: ((id: number, patch: { cwd: string }) => void) | undefined;
  const recent = () => "/recent";
  function Window({ activeId }: { activeId: number }) {
    const [tabs, setTabs] = useState([harness(1, "/one"), harness(2, "remote://machine/two"),
      { id: 3, kind: "terminal", cwd: "/shell", spaceId: "s" } as Tab]);
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    live = tabs;
    const update = useCallback((id: number, patch: { cwd: string }) => setTabs((current) =>
      current.map((tab) => tab.id === id && "cwd" in tab && tab.cwd !== patch.cwd ? { ...tab, ...patch } : tab)), []);
    changeCwd = update;
    result = useHarnessDesktopContext({ activeTab: tabs.find((tab) => tab.id === activeId), tabsRef, updateTab: update, lastProjectPath: recent });
    explorer = useWorkspaceCwd(result.workspaceTab, tabs, "/fallback", "s");
    renders++;
    return null;
  }
  try {
    await act(async () => root.render(<StrictMode><Window activeId={1} /></StrictMode>));
    await act(async () => {
      publishHarnessFocusFolder("/one/src", 1);
      publishHarnessProject("remote://machine/changed", 2);
      publishHarnessFocusFolder("remote://machine/changed/src", 2);
    });
    expect(result?.projectCwd).toBe("/one");
    expect(result?.folder).toBe("/one/src");
    expect(explorer?.explorerRoot).toBe("/one/src");
    expect(live[0]).toMatchObject({ cwd: "/one" });
    await act(async () => root.render(<StrictMode><Window activeId={2} /></StrictMode>));
    expect(result?.projectCwd).toBe("remote://machine/changed");
    expect(explorer?.explorerRoot).toBe("remote://machine/changed/src");
    expect(live[1]).toMatchObject({ cwd: "remote://machine/changed" });
    await act(async () => changeCwd?.(2, { cwd: "C:/disconnected" }));
    expect(live[1]).toMatchObject({ cwd: "C:/disconnected" });
    expect(result?.projectCwd).toBe("C:/disconnected");
    await act(async () => root.render(<StrictMode><Window activeId={3} /></StrictMode>));
    const count = renders;
    await act(async () => {
      publishHarnessFocusFolder("/background", 1);
    });
    expect(renders).toBe(count);
    expect(result?.projectCwd).toBeNull();
    expect(result?.folder).toBeNull();
    expect(result?.workspaceTab).toBe(live[2]);
    expect(explorer?.explorerRoot).toBe("/shell");
  } finally {
    await act(async () => root.unmount());
  }
});

it("refuses to copy a selected report onto a replacement stable tab key", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const selected = harness(1, "/selected");
  const replacement = { ...harness(1, "/replacement"), tabKey: asTabKey("tab-replacement") };
  const update = vi.fn();
  publishHarnessProject("/reported", 1);
  function Chrome() {
    useHarnessDesktopContext({ activeTab: selected, tabsRef: { current: [replacement] }, updateTab: update, lastProjectPath: () => "/recent" });
    return null;
  }
  try {
    await act(async () => root.render(<Chrome />));
    expect(update).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps explicit project fallback selection after the event adapter is removed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let result: ReturnType<typeof useHarnessDesktopContext> | undefined;
  const tab = harness(1);
  function Chrome() {
    result = useHarnessDesktopContext({ activeTab: tab, tabsRef: { current: [tab] }, updateTab: () => {}, lastProjectPath: () => "//server/share/recent" });
    return null;
  }
  await act(async () => root.render(<Chrome />));
  expect(result?.projectCwd).toBe("//server/share/recent");
  await act(async () => result?.setProjectFallback("C:/selected"));
  expect(result?.projectCwd).toBe("C:/selected");
  await act(async () => root.unmount());
  window.dispatchEvent(new CustomEvent("voktty:harness-focus-folder", { detail: { cwd: "/after-close", ownerId: 1 } }));
  expect(useHarnessSurfaceStore.getState().reports[1]).toBeUndefined();
});

it.each(["//server/share/project", "remote://machine/project", "C:/project"])("directs chrome project navigation to its stable owner (%s)", async (path) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const tab = harness(1);
  const receive = vi.fn();
  const legacy = vi.fn();
  const release = subscribeHarnessProjectRequests(receive);
  window.addEventListener("voktty:harness-select-project", legacy);
  let result: ReturnType<typeof useHarnessDesktopContext> | undefined;
  function Chrome() {
    result = useHarnessDesktopContext({ activeTab: tab, tabsRef: { current: [tab] }, updateTab: vi.fn(), lastProjectPath: () => "/recent" });
    return null;
  }
  try {
    await act(async () => root.render(<StrictMode><Chrome /></StrictMode>));
    await act(async () => result?.selectProject(path));
    expect(receive).toHaveBeenCalledExactlyOnceWith({ path, target: { ownerId: 1, tabKey: "tab-1" } });
    expect(result?.projectCwd).toBe(path);
    expect(legacy).not.toHaveBeenCalled();
  } finally {
    release();
    window.removeEventListener("voktty:harness-select-project", legacy);
    await act(async () => root.unmount());
  }
});

it("retires chrome navigation on selection, project, stable identity and mounted-owner changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const original = harness(1);
  const tabsRef = { current: [original] };
  const receive = vi.fn();
  const release = subscribeHarnessProjectRequests(receive);
  let result: ReturnType<typeof useHarnessDesktopContext> | undefined;
  function Chrome({ tab }: { tab: Tab }) {
    result = useHarnessDesktopContext({ activeTab: tab, tabsRef, updateTab: vi.fn(), lastProjectPath: () => "/recent" });
    return null;
  }
  try {
    for (const replacement of [harness(2), harness(1, "/new-project"), { ...original, tabKey: asTabKey("tab-replaced") }]) {
      tabsRef.current = [original];
      await act(async () => root.render(<Chrome tab={original} />));
      const stale = result?.selectProject;
      tabsRef.current = [replacement];
      await act(async () => root.render(<Chrome tab={replacement} />));
      tabsRef.current = [original];
      await act(async () => root.render(<Chrome tab={original} />));
      await act(async () => stale?.("/stale"));
    }
    const departed = result?.selectProject;
    await act(async () => root.render(null));
    departed?.("/unmounted");
    expect(receive).not.toHaveBeenCalled();
    await act(async () => root.render(<Chrome tab={original} />));
    tabsRef.current = [{ ...original, tabKey: asTabKey("tab-before-commit") }];
    await act(async () => result?.selectProject("/replaced-before-render"));
    expect(receive).not.toHaveBeenCalled();
  } finally {
    release();
    await act(async () => root.unmount());
  }
});

it("does not update the project fallback after reentrant owner retirement", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const tab = harness(1);
  const tabsRef = { current: [tab] };
  let result: ReturnType<typeof useHarnessDesktopContext> | undefined;
  const release = subscribeHarnessProjectRequests(() => { tabsRef.current = [harness(2)]; });
  function Chrome() {
    result = useHarnessDesktopContext({ activeTab: tab, tabsRef, updateTab: vi.fn(), lastProjectPath: () => "/recent" });
    return null;
  }
  try {
    await act(async () => root.render(<Chrome />));
    await act(async () => result?.selectProject(" "));
    expect(result?.projectCwd).toBe("/recent");
    await act(async () => result?.selectProject("/retired"));
    expect(result?.projectCwd).toBe("/recent");
  } finally {
    release();
    await act(async () => root.unmount());
  }
});
