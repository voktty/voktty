// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurfaceTabs } from "@/modules/harness/chrome/SurfaceTabs";
import { newTerminalFile } from "@/modules/harness/lib/layout";
import { CanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import { useTerminalProgressStore } from "@/modules/terminal/lib/terminalProgressStore";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

let root: Root;
let node: HTMLDivElement;
const file = {
  ...newTerminalFile("/srv/app/original", "Original title"),
  canonicalTerminal: {
    ...createTabIdentity("main", () => "canonical"),
    projectCwd: "/srv/app",
  },
};
const terminal: TerminalTab = {
  id: 10,
  ...createTabIdentity("main", () => "canonical"),
  kind: "terminal",
  spaceId: "main",
  title: "shell",
  projectCwd: "/srv/app",
  cwd: "/srv/app/current",
  customTitle: "Build server",
  paneTree: { kind: "leaf", id: 11 },
  activeLeafId: 11,
};
const select = vi.fn();
const close = vi.fn();

async function render(tabs: readonly Tab[], withCatalog = true) {
  const strip = (
    <SurfaceTabs
      files={[file]}
      activeFileId={file.id}
      dirtyFileIds={new Set()}
      fileErrorCounts={new Map()}
      onSelectFile={select}
      onCloseFile={close}
      onReorder={() => {}}
    />
  );
  await act(async () =>
    root.render(
      withCatalog ? (
        <CanonicalTerminalCatalog tabs={tabs}>{strip}</CanonicalTerminalCatalog>
      ) : (
        strip
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  select.mockClear();
  close.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    useTerminalProgressStore.getState().clearLeaf(11);
    useTerminalProgressStore.getState().clearLeaf(12);
  });
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("tracks the canonical alias and cwd without mutating legacy metadata or changing file actions", async () => {
  const before = structuredClone(file);
  await render([terminal]);
  expect(node.querySelector('[role="tab"]')?.textContent).toBe("Build server");
  expect(node.querySelector('[role="tab"]')?.getAttribute("title")).toBe(
    "Build server · /srv/app/current",
  );
  const originalButton = node.querySelector('[role="tab"]');
  await render([{ ...terminal, customTitle: "Renamed", cwd: "/srv/app/next" }]);
  expect(node.querySelector('[role="tab"]')).toBe(originalButton);
  expect(originalButton?.textContent).toBe("Renamed");
  expect(originalButton?.getAttribute("title")).toBe("Renamed · /srv/app/next");
  await act(async () => {
    node.querySelector<HTMLButtonElement>('[role="tab"]')?.click();
    node.querySelector<HTMLButtonElement>("button[data-no-drag]")?.click();
  });
  expect(select).toHaveBeenCalledExactlyOnceWith(file.id);
  expect(close).toHaveBeenCalledExactlyOnceWith(file.id);
  expect(file).toEqual(before);
});

it("uses live shell progress from the canonical leaves without creating another terminal", async () => {
  await render([terminal]);
  await act(async () =>
    useTerminalProgressStore.getState().setLeafProgress(11, 35),
  );
  expect(node.querySelector('[style="width: 35%;"]')).not.toBeNull();
  await act(async () =>
    useTerminalProgressStore.getState().setLeafProgress(11, 60),
  );
  expect(node.querySelector('[style="width: 60%;"]')).not.toBeNull();
  await act(async () =>
    useTerminalProgressStore.getState().setLeafProgress(11, null, "failed"),
  );
  expect(node.querySelector(".bg-rose-500\\/80")).not.toBeNull();
  expect(node.querySelectorAll('[role="tab"]')).toHaveLength(1);
});

it("tracks every leaf after splitting the canonical terminal and removes departed leaf status", async () => {
  await render([
    {
      ...terminal,
      paneTree: {
        kind: "split",
        id: 13,
        dir: "row",
        children: [
          { kind: "leaf", id: 11 },
          { kind: "leaf", id: 12 },
        ],
      },
    },
  ]);
  await act(async () =>
    useTerminalProgressStore.getState().setLeafProgress(12, 42),
  );
  expect(node.querySelector('[style="width: 42%;"]')).not.toBeNull();
  await render([terminal]);
  expect(node.querySelector('[style="width: 42%;"]')).toBeNull();
});

it.each<{ workspaceEnv: WorkspaceEnv; label: string }>([
  { workspaceEnv: { kind: "local" }, label: "current" },
  { workspaceEnv: { kind: "wsl", distro: "Ubuntu" }, label: "Ubuntu" },
  {
    workspaceEnv: {
      kind: "docker",
      connection: {
        containerId: "container-a",
        containerName: "Build container",
        image: "build:latest",
      },
    },
    label: "Build container",
  },
  {
    workspaceEnv: { kind: "serial", portName: "COM3", baudRate: 9600 },
    label: "COM3",
  },
])(
  "uses the ordinary tab label policy for $workspaceEnv.kind",
  async ({ workspaceEnv, label }) => {
    await render([{ ...terminal, customTitle: undefined, workspaceEnv }]);
    expect(node.querySelector('[role="tab"]')?.textContent).toBe(label);
  },
);

it("reflects canonical icon overrides without replacing the selectable file tab", async () => {
  await render([{ ...terminal, icon: "server" }]);
  const button = node.querySelector('[role="tab"]');
  const icon = button?.querySelector("svg")?.innerHTML;
  expect(icon).toBeTruthy();
  await render([{ ...terminal, icon: "database" }]);
  expect(node.querySelector('[role="tab"]')).toBe(button);
  expect(button?.querySelector("svg")?.innerHTML).not.toBe(icon);
});

it.each([
  ["missing", []],
  ["other project", [{ ...terminal, projectCwd: "/srv/another" }]],
  ["private", [{ ...terminal, private: true }]],
  ["guest", [{ ...terminal, collaboration: { mode: "guest" as const } }]],
])(
  "retains the layout fallback for a %s canonical reference",
  async (_name, tabs) => {
    await render(tabs);
    expect(node.querySelector('[role="tab"]')?.textContent).toBe(
      "Original title",
    );
    expect(node.querySelector('[role="tab"]')?.getAttribute("title")).toBe(
      "Original title · /srv/app/original",
    );
  },
);

it("works outside the desktop catalog and falls back after a canonical tab disappears", async () => {
  await render([], false);
  expect(node.querySelector('[role="tab"]')?.textContent).toBe(
    "Original title",
  );
  await render([terminal]);
  expect(node.querySelector('[role="tab"]')?.textContent).toBe("Build server");
  await render([]);
  expect(node.querySelector('[role="tab"]')?.textContent).toBe(
    "Original title",
  );
});
