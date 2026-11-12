// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header, isInteractiveHeaderTarget } from "./Header";

const mockStartDragging = vi.fn();
const mockOpenUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: mockStartDragging,
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/modules/agents", () => ({
  NotificationBell: () => <button type="button" aria-label="Notifications" />,
}));

vi.mock("@/modules/agents/components/AgentLauncherPanel", () => ({
  AgentLauncherPanel: () => null,
}));

vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  useAiAvailable: () => false,
}));

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock("@/modules/shortcuts", () => ({
  useShortcutLabel: () => "Ctrl+Shift+P",
}));

vi.mock("@/modules/launcher", () => ({
  useLauncherStore: (selector: (state: { toggleLauncher: () => void }) => unknown) =>
    selector({ toggleLauncher: vi.fn() }),
}));

vi.mock("@/modules/tabs", () => ({
  TabBar: () => (
    <div data-tabs-header data-tauri-drag-region className="group flex h-full min-w-0 flex-1 items-center gap-0.5">
      <div data-testid="tab-item" role="tab" tabIndex={0}>
        <span>Tab 1</span>
      </div>
      <div data-testid="tab-bar-empty-space" className="flex-1 h-full" />
    </div>
  ),
}));

describe("isInteractiveHeaderTarget", () => {
  it("returns true for button elements and their descendants", () => {
    const button = document.createElement("button");
    const iconSpan = document.createElement("span");
    button.appendChild(iconSpan);
    document.body.appendChild(button);

    expect(isInteractiveHeaderTarget(button)).toBe(true);
    expect(isInteractiveHeaderTarget(iconSpan)).toBe(true);

    button.remove();
  });

  it("returns true for role=button and role=tab", () => {
    const roleButton = document.createElement("div");
    roleButton.setAttribute("role", "button");
    const roleTab = document.createElement("div");
    roleTab.setAttribute("role", "tab");

    expect(isInteractiveHeaderTarget(roleButton)).toBe(true);
    expect(isInteractiveHeaderTarget(roleTab)).toBe(true);
  });

  it("returns true for inputs, selects, textareas, and anchors", () => {
    const input = document.createElement("input");
    const select = document.createElement("select");
    const textarea = document.createElement("textarea");
    const anchor = document.createElement("a");

    expect(isInteractiveHeaderTarget(input)).toBe(true);
    expect(isInteractiveHeaderTarget(select)).toBe(true);
    expect(isInteractiveHeaderTarget(textarea)).toBe(true);
    expect(isInteractiveHeaderTarget(anchor)).toBe(true);
  });

  it("returns true for elements marked with data-no-drag or data-tauri-drag-region=false", () => {
    const noDrag = document.createElement("div");
    noDrag.setAttribute("data-no-drag", "");
    const dragRegionFalse = document.createElement("div");
    dragRegionFalse.setAttribute("data-tauri-drag-region", "false");

    expect(isInteractiveHeaderTarget(noDrag)).toBe(true);
    expect(isInteractiveHeaderTarget(dragRegionFalse)).toBe(true);
  });

  it("returns false for header, empty divs, tab strip containers and draggable regions", () => {
    const header = document.createElement("header");
    header.setAttribute("data-tauri-drag-region", "");
    const emptyDiv = document.createElement("div");
    const tabStrip = document.createElement("div");
    tabStrip.setAttribute("data-tabs-header", "");

    expect(isInteractiveHeaderTarget(header)).toBe(false);
    expect(isInteractiveHeaderTarget(emptyDiv)).toBe(false);
    expect(isInteractiveHeaderTarget(tabStrip)).toBe(false);
  });

  it("returns false for null or undefined targets", () => {
    expect(isInteractiveHeaderTarget(null)).toBe(false);
    expect(isInteractiveHeaderTarget(undefined as unknown as EventTarget)).toBe(false);
  });

  it("handles text nodes safely by checking parentElement", () => {
    const button = document.createElement("button");
    const textNode = document.createTextNode("Click me");
    button.appendChild(textNode);
    document.body.appendChild(button);

    expect(isInteractiveHeaderTarget(textNode)).toBe(true);

    const div = document.createElement("div");
    const plainText = document.createTextNode("Plain text");
    div.appendChild(plainText);
    document.body.appendChild(div);

    expect(isInteractiveHeaderTarget(plainText)).toBe(false);

    button.remove();
    div.remove();
  });
});

describe("Header drag and double-click interactions", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onNewMock = vi.fn();
  const onOpenCommandPaletteMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    mockStartDragging.mockClear();
    onNewMock.mockClear();
    onOpenCommandPaletteMock.mockClear();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderHeader(tabStyle: "horizontal" | "vertical" = "horizontal") {
    await act(async () => {
      root.render(
        <Header
          tabs={[]}
          activeId={-1}
          onSelect={vi.fn()}
          onNew={onNewMock}
          onNewBlock={vi.fn()}
          onNewPrivate={vi.fn()}
          onNewEditor={vi.fn()}
          onLaunchAgents={vi.fn()}
          onClose={vi.fn()}
          onCloseTabsToRight={vi.fn()}
          onCloseOtherTabs={vi.fn()}
          onDuplicate={vi.fn()}
          onRename={vi.fn()}
          onReorder={vi.fn()}
          onToggleTabStyle={vi.fn()}
          tabStyle={tabStyle}
          onOpenCommandPalette={onOpenCommandPaletteMock}
          onActivateAgent={vi.fn()}
          onActivateLocalAgent={vi.fn()}
          spaceSwitcher={<div data-testid="space-switcher" role="button">Spaces</div>}
        />,
      );
    });
  }

  it("triggers onNew when double-clicking on empty header space", async () => {
    await renderHeader();

    const header = container.querySelector("header");
    expect(header).not.toBeNull();

    const emptySpace = container.querySelector("[data-testid='tab-bar-empty-space']");
    expect(emptySpace).not.toBeNull();

    act(() => {
      emptySpace?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNewMock).toHaveBeenCalledTimes(1);
  });

  it("triggers onNew when double-clicking in vertical tab mode empty header area", async () => {
    await renderHeader("vertical");

    const header = container.querySelector("header");
    expect(header).not.toBeNull();

    act(() => {
      header?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNewMock).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onNew when double-clicking an interactive element", async () => {
    await renderHeader();

    const tabItem = container.querySelector("[data-testid='tab-item']");
    expect(tabItem).not.toBeNull();

    act(() => {
      tabItem?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNewMock).not.toHaveBeenCalled();

    const spaceSwitcher = container.querySelector("[data-testid='space-switcher']");
    expect(spaceSwitcher).not.toBeNull();

    act(() => {
      spaceSwitcher?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNewMock).not.toHaveBeenCalled();
  });

  it("initiates native window drag on pointer move exceeding 4px on empty header space", async () => {
    await renderHeader();

    const emptySpace = container.querySelector("[data-testid='tab-bar-empty-space']");
    expect(emptySpace).not.toBeNull();

    act(() => {
      emptySpace?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 100,
          clientY: 20,
        }),
      );
    });

    // Small move <= 4px: should NOT start dragging
    act(() => {
      emptySpace?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: 102,
          clientY: 21,
        }),
      );
    });
    expect(mockStartDragging).not.toHaveBeenCalled();

    // Move > 4px: should trigger startDragging()
    act(() => {
      emptySpace?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: 110,
          clientY: 25,
        }),
      );
    });
    expect(mockStartDragging).toHaveBeenCalledTimes(1);
  });

  it("does not initiate window drag when pressing down on an interactive element", async () => {
    await renderHeader();

    const tabItem = container.querySelector("[data-testid='tab-item']");
    expect(tabItem).not.toBeNull();

    act(() => {
      tabItem?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 100,
          clientY: 20,
        }),
      );
    });

    act(() => {
      tabItem?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: 120,
          clientY: 20,
        }),
      );
    });

    expect(mockStartDragging).not.toHaveBeenCalled();
  });

  it("opens the command palette without dragging the window from its icon", async () => {
    await renderHeader();
    const button = container.querySelector<HTMLButtonElement>("button[aria-label^='header.commandPalette']");
    expect(button).not.toBeNull();
    act(() => {
      button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      button?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, clientX: 30, clientY: 10 }));
      button?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 30, clientY: 10 }));
      button?.click();
    });
    expect(mockStartDragging).not.toHaveBeenCalled();
    expect(onOpenCommandPaletteMock).toHaveBeenCalledOnce();
  });

  it("suppresses onNew if a drag occurred prior to double-click", async () => {
    await renderHeader();

    const header = container.querySelector("header");
    expect(header).not.toBeNull();

    // Start drag
    act(() => {
      header?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 200,
          clientY: 15,
        }),
      );
      header?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: 220,
          clientY: 15,
        }),
      );
    });
    expect(mockStartDragging).toHaveBeenCalledTimes(1);

    // Dblclick following a drag is suppressed
    act(() => {
      header?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNewMock).not.toHaveBeenCalled();
  });

  it("renders the Star on GitHub button and triggers openUrl on click", async () => {
    await renderHeader();

    const starButton = container.querySelector(
      "button[aria-label='header.starOnGithub']",
    );
    expect(starButton).not.toBeNull();

    act(() => {
      starButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://github.com/voktty/voktty",
    );
  });
});
