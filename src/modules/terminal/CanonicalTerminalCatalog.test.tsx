// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CanonicalTerminalCatalog,
  useCanonicalTerminalCatalog,
} from "@/modules/terminal/CanonicalTerminalCatalog";
import { useTabCloseGuards } from "@/app/hooks/useTabCloseGuards";
import { planTerminalSubsetClose } from "@/app/hooks/tabCloseGuards";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs";
import { usePreferencesStore } from "@/modules/settings/preferences";

const native = vi.hoisted(() => ({ known: vi.fn(), foreground: vi.fn() }));
vi.mock("@/modules/terminal", () => ({
  leafIds: (tree: { id: number }) => [tree.id],
  leafHasKnownActivity: native.known,
  leafHasForegroundProcess: native.foreground,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
const terminal: TerminalTab = {
  id: 42,
  ...createTabIdentity("main", () => "shell"),
  spaceId: "main",
  kind: "terminal",
  title: "shell",
  projectCwd: "/srv/app",
  paneTree: { kind: "leaf", id: 43 },
  activeLeafId: 43,
};
const reference = { tabKey: terminal.tabKey, projectCwd: "/srv/app" };
it("bounds explicit terminal batches and excludes duplicate, unknown and nonterminal targets", () => {
  const editor: Tab = {
    ...terminal,
    id: 80,
    kind: "editor",
    path: "/srv/app/file.txt",
    dirty: false,
    preview: false,
  };
  expect(
    planTerminalSubsetClose(
      [terminal, editor],
      [42, 42, 80, 999, Number.NaN],
      1,
    ),
  ).toEqual({ closeIds: [42], nextActiveId: 1 });
  expect(planTerminalSubsetClose([terminal], Array(257).fill(42), 1)).toEqual({
    closeIds: [],
    nextActiveId: 1,
  });
});
let root: Root;
let node: HTMLDivElement;
let catalog: ReturnType<typeof useCanonicalTerminalCatalog>;
let guard: ReturnType<typeof useTabCloseGuards>;
let replace: (tabs: Tab[]) => void;
let current: Tab[];
function Read() {
  catalog = useCanonicalTerminalCatalog();
  return null;
}
function Host() {
  const [tabs, setTabs] = useState<Tab[]>([terminal]);
  current = tabs;
  replace = setTabs;
  guard = useTabCloseGuards({
    tabs,
    activeId: 42,
    disposeTab: (id) =>
      setTabs((previous) => previous.filter((tab) => tab.id !== id)),
    disposeTabs: (_anchor, plan) =>
      setTabs((previous) =>
        previous.filter((tab) => !plan.closeIds.includes(tab.id)),
      ),
  });
  return (
    <CanonicalTerminalCatalog tabs={tabs} onClose={guard.handleClose}>
      <Read />
    </CanonicalTerminalCatalog>
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  usePreferencesStore.setState({ confirmCloseRunningTerminal: true });
  native.known.mockReturnValue(true);
  native.foreground.mockResolvedValue(true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root.render(<Host />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("routes a dock close through the real foreground guard and preserves the tab on cancellation", async () => {
  await act(async () => {
    await catalog?.requestClose(reference);
  });
  expect(guard.pendingTerminalCloseTab).toBe(42);
  expect(current).toHaveLength(1);
  await act(async () => guard.cancelTerminalClose());
  expect(guard.pendingTerminalCloseTab).toBeNull();
  expect(catalog?.get(reference)).toBe(terminal);
  await act(async () => {
    await catalog?.requestClose(reference);
  });
  await act(async () => guard.confirmTerminalClose());
  expect(current).toEqual([]);
  expect(catalog?.get(reference)).toBeUndefined();
});
it("resolves stable keys to the current runtime id instead of retaining a restored id", async () => {
  await act(async () => replace([{ ...terminal, id: 99 }]));
  await act(async () => {
    await catalog?.requestClose(reference);
  });
  expect(guard.pendingTerminalCloseTab).toBe(99);
  expect(current).toHaveLength(1);
});
it("asks once for an exact terminal batch and retains unrelated and locked tabs", async () => {
  const sibling = {
    ...terminal,
    ...createTabIdentity("main", () => "sibling"),
    id: 50,
    paneTree: { kind: "leaf" as const, id: 51 },
  };
  const locked = {
    ...terminal,
    ...createTabIdentity("main", () => "locked"),
    id: 60,
    locked: true,
  };
  const unrelated = {
    ...terminal,
    ...createTabIdentity("main", () => "unrelated"),
    id: 70,
  };
  await act(async () => replace([terminal, sibling, locked, unrelated]));
  const references = [
    reference,
    { ...reference, tabKey: sibling.tabKey },
    { ...reference, tabKey: locked.tabKey },
  ];
  await act(async () => {
    await catalog?.requestCloseMany(references);
  });
  expect(guard.pendingTerminalCloseTab).toBeNull();
  expect(guard.pendingCloseMany?.plan.closeIds).toEqual([42, 50]);
  await act(async () => guard.cancelCloseMany());
  expect(current).toHaveLength(4);
  await act(async () => {
    await catalog?.requestCloseMany(references);
  });
  await act(async () => guard.confirmCloseMany());
  expect(current.map((tab) => tab.id)).toEqual([60, 70]);
});
it("retires a retained close callback when its catalog unmounts", async () => {
  const old = catalog;
  await act(async () => root.render(null));
  await expect(old?.requestClose(reference)).resolves.toBe(false);
  await expect(old?.requestCloseMany([reference])).resolves.toBe(false);
  expect(native.known).not.toHaveBeenCalled();
});
it.each(["single", "batch"])(
  "preserves a terminal locked while its %s confirmation is open",
  async (kind) => {
    await act(async () => {
      if (kind === "single") await catalog?.requestClose(reference);
      else await catalog?.requestCloseMany([reference]);
    });
    await act(async () => replace([{ ...terminal, locked: true }]));
    await act(async () => {
      if (kind === "single") guard.confirmTerminalClose();
      else await guard.confirmCloseMany();
    });
    expect(current).toHaveLength(1);
    expect(current[0].locked).toBe(true);
  },
);
it.each([
  { projectCwd: "/srv/other" },
  { private: true },
  { kind: "harness" as const },
])(
  "refuses a mismatched or unavailable canonical resource: %j",
  async (patch) => {
    await act(async () => replace([{ ...terminal, ...patch } as Tab]));
    expect(catalog?.get(reference)).toBeUndefined();
    await expect(catalog?.requestClose(reference)).resolves.toBe(false);
    expect(native.known).not.toHaveBeenCalled();
    expect(current).toHaveLength(1);
  },
);
