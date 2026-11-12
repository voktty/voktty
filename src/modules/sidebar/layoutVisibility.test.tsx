// @vitest-environment happy-dom
import { act, useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarRail } from "@/modules/sidebar/SidebarRail";
import { useLayoutVisibilityStore } from "@/modules/sidebar/layoutVisibility";
import { useSidebarPanel } from "@/modules/sidebar/useSidebarPanel";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useLayoutVisibilityStore.setState({ focusMode: false });
});

afterEach(() => {
  useLayoutVisibilityStore.setState({ focusMode: false });
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each([0, 337])(
  "restores the exact sidebar width %ipx without changing preferences or remounting content",
  async (initialWidth) => {
    const collapsedPreference = initialWidth === 0 ? "1" : "0";
    localStorage.setItem("voktty.sidebar.collapsed", collapsedPreference);
    localStorage.setItem("voktty.sidebar.width", "300");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const mounted = vi.fn();
    const unmounted = vi.fn();
    let width = initialWidth;
    let onResize = (_next: number) => {};
    const panel = {
      getSize: () => ({ inPixels: width, asPercentage: width > 0 ? 30 : 0 }),
      collapse: vi.fn(() => {
        width = 0;
        onResize(width);
      }),
      resize: vi.fn((next: string) => {
        width = Number.parseFloat(next);
        onResize(width);
      }),
    } as unknown as PanelImperativeHandle;

    function LiveContent() {
      useEffect(() => {
        mounted();
        return () => { unmounted(); };
      }, []);
      return <input aria-label="draft" defaultValue="keep this draft" />;
    }

    function Fixture() {
      const explorerRef = useRef(null);
      const sidebar = useSidebarPanel(explorerRef);
      const focusMode = useLayoutVisibilityStore((state) => state.focusMode);
      useLayoutEffect(() => {
        sidebar.sidebarRef.current = panel;
        onResize = (next) => {
          sidebar.persistSidebarCollapsed(next <= 0);
          sidebar.persistSidebarWidth(next, false);
        };
      });
      return (
        <TooltipProvider>
          <SidebarRail
            activeView={focusMode || sidebar.sidebarCollapsed ? null : sidebar.sidebarView}
            onSelectView={sidebar.cycleSidebarView}
            changedCount={0}
            workspaceRoot={null}
            harnessActive
          />
          <div hidden={focusMode} inert={focusMode || undefined}>
            <LiveContent />
          </div>
        </TooltipProvider>
      );
    }

    try {
      await act(async () => root.render(<Fixture />));
      const draft = container.querySelector("input")!;
      draft.value = "unsaved input";
      const focus = container.querySelector<HTMLButtonElement>(
        '[aria-label="shortcuts.labels.viewFocusMode"]',
      )!;
      const sessions = container.querySelector<HTMLButtonElement>(
        '[aria-label="shortcuts.labels.harnessSessionsToggle"]',
      )!;
      expect(focus.disabled).toBe(false);
      expect(sessions.disabled).toBe(false);

      for (let cycle = 0; cycle < 2; cycle += 1) {
        await act(async () => focus.click());
        expect(width).toBe(0);
        expect(focus.getAttribute("aria-pressed")).toBe("true");
        expect(sessions.disabled).toBe(true);
        expect(draft.parentElement?.hidden).toBe(true);
        expect(localStorage.getItem("voktty.sidebar.collapsed")).toBe(collapsedPreference);
        expect(localStorage.getItem("voktty.sidebar.width")).toBe("300");

        await act(async () => focus.click());
        expect(width).toBe(initialWidth);
        expect(focus.getAttribute("aria-pressed")).toBe("false");
        expect(sessions.disabled).toBe(false);
        expect(draft.parentElement?.hidden).toBe(false);
        expect(container.querySelector("input")).toBe(draft);
        expect(draft.value).toBe("unsaved input");
        expect(localStorage.getItem("voktty.sidebar.collapsed")).toBe(collapsedPreference);
        expect(localStorage.getItem("voktty.sidebar.width")).toBe("300");
      }
      expect(mounted).toHaveBeenCalledTimes(1);
      expect(unmounted).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    expect(unmounted).toHaveBeenCalledTimes(1);
  },
);

it("keeps focus available on every surface and only sends session toggles from an active Harness", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const toggleSessions = vi.fn();
  window.addEventListener("voktty:toggle-harness-sessions", toggleSessions);
  const renderRail = (harnessActive: boolean) => (
    <TooltipProvider>
      <SidebarRail
        activeView={null}
        onSelectView={() => {}}
        changedCount={0}
        workspaceRoot={null}
        harnessActive={harnessActive}
      />
    </TooltipProvider>
  );
  try {
    await act(async () => root.render(renderRail(false)));
    const focus = container.querySelector<HTMLButtonElement>(
      '[aria-label="shortcuts.labels.viewFocusMode"]',
    )!;
    const sessions = container.querySelector<HTMLButtonElement>(
      '[aria-label="shortcuts.labels.harnessSessionsToggle"]',
    )!;
    expect(focus.disabled).toBe(false);
    expect(sessions.disabled).toBe(true);
    await act(async () => sessions.click());
    expect(toggleSessions).not.toHaveBeenCalled();

    await act(async () => root.render(renderRail(true)));
    expect(sessions.disabled).toBe(false);
    await act(async () => sessions.click());
    expect(toggleSessions).toHaveBeenCalledTimes(1);

    await act(async () => focus.click());
    expect(sessions.disabled).toBe(true);
    await act(async () => sessions.click());
    expect(toggleSessions).toHaveBeenCalledTimes(1);
    expect(focus.disabled).toBe(false);
    await act(async () => focus.click());
    expect(sessions.disabled).toBe(false);
  } finally {
    window.removeEventListener("voktty:toggle-harness-sessions", toggleSessions);
    await act(async () => root.unmount());
    container.remove();
  }
});

it("opens an explicitly requested view from focus mode without restoring a previously collapsed panel over it", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let width = 0;
  const panel = {
    getSize: () => ({ inPixels: width, asPercentage: width > 0 ? 30 : 0 }),
    collapse: () => { width = 0; },
    resize: (next: string) => { width = Number.parseFloat(next); },
  } as unknown as PanelImperativeHandle;
  function Fixture() {
    const sidebar = useSidebarPanel(useRef(null));
    useLayoutEffect(() => { sidebar.sidebarRef.current = panel; });
    return <button type="button" onClick={() => sidebar.openSidebarView("source-control")}>{sidebar.sidebarView}</button>;
  }
  try {
    await act(async () => root.render(<Fixture />));
    await act(async () => useLayoutVisibilityStore.getState().toggleFocus());
    expect(width).toBe(0);
    await act(async () => container.querySelector("button")!.click());
    expect(useLayoutVisibilityStore.getState().focusMode).toBe(false);
    expect(width).toBe(260);
    expect(container.textContent).toBe("source-control");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
