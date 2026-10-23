// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import {
  useTabs,
  type Tab,
  type TerminalTab,
} from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import {
  CanonicalTerminalCatalog,
  useCanonicalTerminalCatalog,
} from "@/modules/terminal/CanonicalTerminalCatalog";
import {
  TerminalSurfaceProvider,
  useTerminalSurfaceController,
} from "@/modules/terminal/TerminalSurface";

vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const owner: Tab = {
  id: 1,
  ...createTabIdentity("main", () => "owner"),
  kind: "harness",
  spaceId: "main",
  title: "Harness",
  cwd: "/srv/app",
};
function terminal(count = 1): TerminalTab {
  const leaves = Array.from({ length: count }, (_, index) => ({
    kind: "leaf" as const,
    id: 20 + index,
  }));
  return {
    id: 2,
    ...createTabIdentity("main", () => "shell"),
    kind: "terminal",
    spaceId: "main",
    title: "shell",
    projectCwd: "/srv/app",
    cold: true,
    activeLeafId: 20,
    paneTree:
      count === 1
        ? leaves[0]
        : { kind: "split", id: 100, dir: "row", children: leaves },
  };
}
type Warm = { ids: number[]; admit: (tabs: readonly Tab[]) => boolean };
let pending: Warm[];
let runtime: ReturnType<typeof useTabs>;
let surfaces: NonNullable<ReturnType<typeof useTerminalSurfaceController>>;
let catalog: NonNullable<ReturnType<typeof useCanonicalTerminalCatalog>>;
let root: Root;
let node: HTMLDivElement;
const onWarm = (ids: number[], admit: Warm["admit"]) =>
  pending.push({ ids, admit });
function Read() {
  const controller = useTerminalSurfaceController();
  const current = useCanonicalTerminalCatalog();
  assert(controller);
  assert(current);
  surfaces = controller;
  catalog = current;
  return null;
}
function Runtime() {
  runtime = useTabs();
  return (
    <TerminalSurfaceProvider>
      <CanonicalTerminalCatalog
        tabs={runtime.tabs}
        activeId={runtime.activeId}
        onWarm={onWarm}
      >
        <Read />
      </CanonicalTerminalCatalog>
    </TerminalSurfaceProvider>
  );
}
function register(source: TerminalTab) {
  return surfaces.register({
    tabKey: source.tabKey,
    ownerTabKey: owner.tabKey,
    projectCwd: "/srv/app",
    focused: false,
    rect: null,
    slotKey: "dock",
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pending = [];
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root.render(<Runtime />));
  await act(async () => {
    runtime.replaceTabs([owner, terminal()], 1);
    runtime.markBooted();
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("rejects a delayed activation after its surface retires", async () => {
  const source = runtime.getTab(2) as TerminalTab;
  let receipt: ReturnType<typeof register>;
  await act(async () => {
    receipt = register(source);
  });
  expect(pending).toHaveLength(1);
  const request = pending[0];
  await act(async () => receipt.release());
  await act(async () => runtime.warmTabs(request.ids, request.admit));
  expect(runtime.getTab(2)?.cold).toBe(true);
});
it("checks queued project changes inside the real tab state updater", async () => {
  await act(async () => {
    register(runtime.getTab(2) as TerminalTab);
  });
  const request = pending[0];
  await act(async () => {
    runtime.updateTab(1, { cwd: "/srv/other" });
    runtime.warmTabs(request.ids, request.admit);
  });
  expect(runtime.getTab(2)?.cold).toBe(true);
});
it("never warms a replacement reusing a captured runtime id", async () => {
  await act(async () => {
    register(runtime.getTab(2) as TerminalTab);
  });
  const request = pending[0];
  const replacement = {
    ...terminal(),
    ...createTabIdentity("main", () => "replacement"),
  };
  await act(async () => {
    runtime.replaceTabs([owner, replacement], 1);
    runtime.warmTabs(request.ids, request.admit);
  });
  expect(runtime.getTab(2)).toBe(replacement);
  expect(replacement.cold).toBe(true);
});
it("does not let a replacement Harness owner inherit a queued activation", async () => {
  const source = runtime.getTab(2) as TerminalTab;
  await act(async () => {
    register(source);
  });
  const request = pending[0];
  await act(async () => {
    runtime.replaceTabs([{ ...owner, title: "Replacement" }, source], 1);
    runtime.warmTabs(request.ids, request.admit);
  });
  expect(source.cold).toBe(true);
  expect(runtime.getTab(2)?.cold).toBe(true);
});
it("retries cold activation when captured pending creation capacity is collected", async () => {
  const hold = catalog.reserve({
    ownerTabKey: owner.tabKey,
    projectCwd: "/srv/app",
    slotKey: "pending",
  });
  expect(hold).toBeDefined();
  const source = terminal(8);
  await act(async () => {
    runtime.replaceTabs([owner, source], 1);
    register(source);
  });
  expect(pending).toEqual([]);
  await act(async () => {
    hold?.retire();
  });
  expect(pending).toEqual([]);
  await act(async () => {
    hold?.release();
  });
  expect(pending).toHaveLength(1);
  const request = pending[0];
  await act(async () => runtime.warmTabs(request.ids, request.admit));
  expect(runtime.getTab(2)?.cold).toBe(false);
  expect(runtime.activeId).toBe(1);
});
it("invalidates a captured activation when its catalog unmounts", async () => {
  await act(async () => {
    register(runtime.getTab(2) as TerminalTab);
  });
  const request = pending[0];
  const tabs = runtime.tabs;
  await act(async () => root.render(null));
  expect(request.admit(tabs)).toBe(false);
});
