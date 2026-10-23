// @vitest-environment happy-dom
import { StrictMode, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalStack } from "@/modules/terminal/TerminalStack";
import {
  TerminalSurface,
  TerminalSurfaceProvider,
} from "@/modules/terminal/TerminalSurface";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab, HarnessTab } from "@/modules/tabs";
import {
  WorkspaceSurface,
  type WorkspaceSurfaceProps,
} from "@/app/components/WorkspaceSurface";

const mocks = vi.hoisted(() => ({
  mounts: vi.fn(),
  unmounts: vi.fn(),
  focus: vi.fn(),
  ownerFocus: vi.fn(),
}));
vi.mock("@/modules/spaces", () => ({
  useSpaces: (selector: (state: { spaces: [] }) => unknown) =>
    selector({ spaces: [] }),
}));
vi.mock("@/modules/editor", () => ({
  AiDiffStack: () => null,
  EditorStack: () => null,
  GitDiffStack: () => null,
}));
vi.mock("@/modules/git-history", () => ({
  GitCommitDiffStack: () => null,
  GitHistoryStack: () => null,
}));
vi.mock("@/modules/api-client/components/ApiClientStackLazy", () => ({
  ApiClientStackLazy: () => null,
}));
vi.mock("@/modules/markdown", () => ({ MarkdownStack: () => null }));
vi.mock("@/modules/preview/PreviewStackLazy", () => ({
  PreviewStackLazy: () => null,
}));
vi.mock("@/modules/rdp", () => ({ RdpStack: () => null }));
vi.mock("@/modules/terminal", async () => ({
  TerminalStack: (await import("@/modules/terminal/TerminalStack"))
    .TerminalStack,
}));
vi.mock("@/modules/harness/components/HarnessStack", () => ({
  HarnessStack: () => (
    <TerminalSurface
      tabKey={terminal.tabKey}
      ownerTabKey={owner.tabKey}
      projectCwd="/srv/app"
      visible
      focused
      onFocus={() => mocks.ownerFocus()}
    />
  ),
}));
vi.mock("@/modules/terminal/PaneTreeView", () => ({
  PaneTreeView: (props: {
    node: { id: number };
    tabVisible: boolean;
    activeLeafId: number | null;
    onFocusLeaf: (id: number) => void;
  }) => {
    useEffect(() => {
      mocks.mounts(props.node.id);
      return () => {
        mocks.unmounts(props.node.id);
      };
    }, [props.node.id]);
    return (
      <button
        type="button"
        data-leaf={props.node.id}
        data-visible={props.tabVisible}
        data-focused={props.activeLeafId !== null}
        onClick={() => props.onFocusLeaf(props.node.id)}
      />
    );
  },
}));

const owner: HarnessTab = {
  id: 1,
  ...createTabIdentity("main", () => "owner"),
  spaceId: "main",
  kind: "harness",
  title: "Harness",
  cwd: "/srv/app",
};
const terminal: TerminalTab = {
  id: 2,
  ...createTabIdentity("main", () => "terminal"),
  spaceId: "main",
  kind: "terminal",
  title: "shell",
  projectCwd: "/srv/app",
  paneTree: { kind: "leaf", id: 20 },
  activeLeafId: 20,
};
let root: Root;
let container: HTMLDivElement;
let targetRect = { left: 100, top: 350, width: 400, height: 200 };
let observers: Array<{
  callback: () => void;
  disconnect: ReturnType<typeof vi.fn>;
}>;

function Host({
  visible = true,
  focused = true,
  revision = 0,
  activeId = 1,
  tabs = [owner, terminal],
}: {
  visible?: boolean;
  focused?: boolean;
  revision?: number;
  activeId?: number;
  tabs?: Tab[];
}) {
  return (
    <TerminalSurfaceProvider>
      <TerminalStack
        tabs={tabs}
        activeId={activeId}
        registerHandle={vi.fn()}
        onSearchReady={vi.fn()}
        onCwd={vi.fn()}
        onExit={vi.fn()}
        onFocusLeaf={mocks.focus}
      />
      <TerminalSurface
        tabKey={terminal.tabKey}
        ownerTabKey={owner.tabKey}
        projectCwd="/srv/app"
        visible={visible}
        focused={focused}
        layoutKey={revision}
        onFocus={mocks.ownerFocus}
      />
    </TerminalSurfaceProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(callback: () => void) {
        observers.push({ callback, disconnect: this.disconnect });
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return (
        this.hasAttribute("data-terminal-surface")
          ? targetRect
          : { left: 100, top: 50, width: 800, height: 600 }
      ) as DOMRect;
    },
  );
  targetRect = { left: 100, top: 350, width: 400, height: 200 };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const pane = () =>
  container.querySelector<HTMLElement>("[data-terminal-tab='2']");

it("moves only the existing stack geometry when a dock relocates, hides and reopens", async () => {
  await act(async () => root.render(<Host />));
  const original = pane();
  expect(original?.dataset.terminalDocked).toBe("true");
  expect(original?.style.left).toBe("0%");
  expect(original?.style.top).toBe("50%");
  expect(original?.style.width).toBe("50%");
  expect(mocks.mounts).toHaveBeenCalledExactlyOnceWith(20);
  targetRect = { left: 500, top: 50, width: 400, height: 600 };
  await act(async () => root.render(<Host revision={1} />));
  expect(pane()).toBe(original);
  expect(pane()?.style.left).toBe("50%");
  expect(pane()?.style.height).toBe("100%");
  await act(async () => root.render(<Host visible={false} revision={2} />));
  expect(pane()).toBe(original);
  expect(pane()?.style.visibility).toBe("hidden");
  expect(mocks.unmounts).not.toHaveBeenCalled();
  await act(async () => root.render(<Host revision={3} />));
  expect(pane()).toBe(original);
  expect(pane()?.style.visibility).toBe("visible");
  expect(mocks.mounts).toHaveBeenCalledOnce();
});

it("returns the same terminal to standalone geometry without duplicating its view", async () => {
  await act(async () => root.render(<Host />));
  const original = pane();
  await act(async () => root.render(<Host activeId={2} />));
  expect(pane()).toBe(original);
  expect(pane()?.dataset.terminalDocked).toBeUndefined();
  expect(pane()?.style.width).toBe("100%");
  expect(pane()?.style.visibility).toBe("visible");
  expect(mocks.mounts).toHaveBeenCalledOnce();
  expect(mocks.unmounts).not.toHaveBeenCalled();
});

it("routes leaf focus through the current dock and retains the owning Harness view", async () => {
  await act(async () => root.render(<Host />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>("[data-leaf='20']")?.click(),
  );
  expect(mocks.ownerFocus).toHaveBeenCalledOnce();
  expect(mocks.focus).toHaveBeenCalledExactlyOnceWith(2, 20);
  await act(async () => root.render(<Host focused={false} />));
  expect(
    container.querySelector<HTMLElement>("[data-leaf='20']")?.dataset.focused,
  ).toBe("false");
});

it("drops the presentation when its Harness owner disappears while retaining the terminal mount", async () => {
  await act(async () => root.render(<Host />));
  const original = pane();
  await act(async () => root.render(<Host tabs={[terminal]} />));
  expect(pane()).toBe(original);
  expect(pane()?.style.visibility).toBe("hidden");
  expect(mocks.unmounts).not.toHaveBeenCalled();
});

it("starts no geometry observers without a visible surface and cancels queued measurements on release", async () => {
  await act(async () => root.render(<Host visible={false} />));
  expect(observers).toHaveLength(0);
  await act(async () => root.render(<Host />));
  expect(observers).toHaveLength(2);
  for (const observer of observers) observer.callback();
  await act(async () => root.render(<Host visible={false} />));
  expect(
    observers.every((observer) => observer.disconnect.mock.calls.length === 1),
  ).toBe(true);
  await act(async () => vi.runOnlyPendingTimersAsync());
  expect(pane()?.style.visibility).toBe("hidden");
});

it("does not mount or warm a cold terminal from a presentation request", async () => {
  await act(async () =>
    root.render(<Host tabs={[owner, { ...terminal, cold: true }]} />),
  );
  expect(pane()).toBeNull();
  expect(mocks.mounts).not.toHaveBeenCalled();
});

it("keeps the terminal layer visible and pointer-passive while Harness owns the active surface", async () => {
  const props: WorkspaceSurfaceProps = {
    tabs: [owner, terminal],
    activeId: 1,
    activeTab: owner,
    registerTerminalHandle: vi.fn(),
    onSearchReady: vi.fn(),
    onCwd: vi.fn(),
    onExit: vi.fn(),
    onFocusLeaf: vi.fn(),
    registerEditorHandle: vi.fn(),
    registerEditorGroupHandle: vi.fn(),
    onActivateEditorTab: vi.fn(),
    onEditorDirtyChange: vi.fn(),
    onEditorCloseTab: vi.fn(),
    registerPreviewHandle: vi.fn(),
    onPreviewUrlChange: vi.fn(),
    onAiDiffAccept: vi.fn(),
    onAiDiffReject: vi.fn(),
    onOpenCommitFile: vi.fn(),
    onOpenCommitDiff: vi.fn(),
    onGitHistorySearchHandle: vi.fn(),
    onSetMarkdownView: vi.fn(),
    onWorkspaceEdit: vi.fn(),
    canNavigateBack: false,
    canNavigateForward: false,
    onNavigateBack: vi.fn(),
    onNavigateForward: vi.fn(),
  };
  await act(async () => root.render(<WorkspaceSurface {...props} />));
  const layer = pane()?.parentElement?.parentElement;
  expect(pane()?.dataset.terminalDocked).toBe("true");
  expect(layer?.getAttribute("aria-hidden")).toBe("false");
  expect(layer?.classList.contains("invisible")).toBe(false);
  expect(layer?.classList.contains("pointer-events-none")).toBe(true);
  expect(layer?.classList.contains("z-10")).toBe(true);
  expect(mocks.mounts).toHaveBeenCalledExactlyOnceWith(20);
});

it("replays StrictMode registrations without leaving a retired placement or observer", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Host />
      </StrictMode>,
    ),
  );
  expect(pane()?.dataset.terminalDocked).toBe("true");
  const mounts = mocks.mounts.mock.calls.length;
  await act(async () =>
    root.render(
      <StrictMode>
        <Host visible={false} />
      </StrictMode>,
    ),
  );
  expect(pane()?.style.visibility).toBe("hidden");
  expect(mocks.mounts).toHaveBeenCalledTimes(mounts);
  expect(
    observers.every((observer) => observer.disconnect.mock.calls.length === 1),
  ).toBe(true);
});
