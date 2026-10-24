// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTabFileManagerReveal } from "@/modules/tabs/lib/useTabFileManagerReveal";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import { TabBar } from "@/modules/tabs/TabBar";
import { VerticalTabBar } from "@/modules/tabs/VerticalTabBar";
import { useWorkspaceEnvStore } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ reveal: vi.fn() }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_WINDOWS: false,
}));
vi.mock("@/modules/explorer/lib/contextActions", () => ({
  revealInFinder: mocks.reveal,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/tabs/NewTabMenu", () => ({ NewTabMenu: () => null }));
let root: Root;
let node: HTMLDivElement;
let service: ReturnType<typeof useTabFileManagerReveal>;
const no = () => {};
function terminal(id = 1): TerminalTab {
  return {
    ...createTabIdentity("main", () => String(id)),
    kind: "terminal",
    id,
    spaceId: "main",
    title: "shell",
    cwd: "/work/app",
    workspaceEnv: { kind: "local" },
    paneTree: { kind: "leaf", id: id + 100 },
    activeLeafId: id + 100,
  };
}
function Probe({ tabs }: { tabs: Tab[] }) {
  service = useTabFileManagerReveal(tabs);
  return null;
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
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(no);
  mocks.reveal.mockReset();
  useSpaces.setState({ spaces: [], activeId: null });
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps a background tab as the destination and refuses stale callbacks after replacement, navigation or unmount", async () => {
  const source = terminal();
  await act(async () => root.render(<Probe tabs={[source, terminal(2)]} />));
  const reveal = service.reveal;
  reveal(source);
  expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith("/work/app");
  await act(async () =>
    root.render(<Probe tabs={[{ ...source, cwd: "/work/other" }]} />),
  );
  reveal(source);
  await act(async () =>
    root.render(
      <Probe
        tabs={[
          { ...source, ...createTabIdentity("main", () => "replacement") },
        ]}
      />,
    ),
  );
  reveal(source);
  expect(mocks.reveal).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  reveal(source);
  expect(mocks.reveal).toHaveBeenCalledOnce();
});

it("rechecks the owning workspace when a cached callback is invoked", async () => {
  const source = { ...terminal(), workspaceEnv: undefined };
  await act(async () => root.render(<Probe tabs={[source]} />));
  const reveal = service.reveal;
  await act(async () =>
    useSpaces.setState({
      spaces: [
        {
          id: "main",
          name: "Main",
          root: "/srv/app",
          createdAt: 1,
          updatedAt: 1,
          env: {
            kind: "ssh",
            root: "/srv/app",
            connection: { id: "build", name: "Build", host: "build.example" },
          },
        },
      ],
    }),
  );
  reveal(source);
  expect(mocks.reveal).not.toHaveBeenCalled();
});

it.each(["horizontal", "vertical"] as const)(
  "gates the %s context menu using the pointed tab rather than the active remote workspace",
  async (direction) => {
    const local = terminal(1);
    const remote: TerminalTab = {
      ...terminal(2),
      workspaceEnv: {
        kind: "ssh",
        root: "/srv/app",
        connection: { id: "build", name: "Build", host: "build.example" },
      },
    };
    useWorkspaceEnvStore.setState({ env: remote.workspaceEnv });
    const props = {
      tabs: [local, remote],
      activeId: remote.id,
      onSelect: no,
      onClose: no,
      onDuplicate: no,
      onRename: no,
      onReorder: no,
      onPin: no,
    };
    await act(async () =>
      root.render(
        direction === "horizontal" ? (
          <TabBar
            {...props}
            onNew={no}
            onNewBlock={no}
            onNewPrivate={no}
            onNewEditor={no}
            onLaunchAgents={no}
            onCloseTabsToRight={no}
            onCloseOtherTabs={no}
          />
        ) : (
          <VerticalTabBar {...props} />
        ),
      ),
    );
    const open = async (id: number) => {
      await act(async () =>
        node
          .querySelector(`[data-tab-id="${id}"]`)
          ?.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              button: 2,
              clientX: 10,
              clientY: 10,
            }),
          ),
      );
      const item = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((item) => item.textContent?.startsWith("Reveal in File Explorer"));
      if (!item) throw new Error("Missing file manager command.");
      return item;
    };
    const allowed = await open(local.id);
    expect(allowed.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => allowed.click());
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith("/work/app");
    const denied = await open(remote.id);
    expect(denied.getAttribute("aria-disabled")).toBe("true");
    expect(denied.textContent).toContain("Local Machine");
    await act(async () => denied.click());
    expect(mocks.reveal).toHaveBeenCalledOnce();
  },
);
