// @vitest-environment happy-dom
import {
  act,
  type InputHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExplorerSearch } from "@/modules/explorer/ExplorerSearch";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  change: null as ((value: string) => void) | null,
  menuActions: [] as (() => void)[],
}));
vi.mock("@/components/ui/context-menu", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ContextMenu: Wrapper,
    ContextMenuTrigger: Wrapper,
    ContextMenuContent: Wrapper,
    ContextMenuSeparator: () => null,
    ContextMenuItem: ({
      children,
      onSelect,
    }: {
      children?: ReactNode;
      onSelect: () => void;
    }) => {
      io.menuActions.push(onSelect);
      return (
        <button type="button" onClick={onSelect}>
          {children}
        </button>
      );
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/explorer/lib/iconResolver", () => ({
  fileIconUrl: () => "",
}));
vi.mock("@/components/ui/input", async () => {
  const { forwardRef } = await import("react");
  return {
    Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => {
        io.change = (value) =>
          props.onChange?.({
            target: { value },
          } as ChangeEvent<HTMLInputElement>);
        return <input {...props} ref={ref} />;
      },
    ),
  };
});
let root: Root;
let node: HTMLDivElement;
async function render(
  workspace: WorkspaceEnv = { kind: "local" },
  path = "/repo",
  onOpenFile: (path: string) => void = () => {},
  open = true,
) {
  await act(async () =>
    root.render(
      <ExplorerSearch
        rootPath={path}
        workspace={workspace}
        open={open}
        onRequestClose={() => {}}
        onOpenFile={onOpenFile}
      />,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  io.invoke.mockReset();
  io.menuActions = [];
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
});

it("searches the original local filesystem while the global workspace is WSL", async () => {
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "unrelated" } });
  io.invoke.mockResolvedValue({ hits: [], truncated: false });
  await render();
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(io.invoke).toHaveBeenCalledWith(
    "fs_search",
    expect.objectContaining({ root: "/repo", workspace: { kind: "local" } }),
  );
});

it("explains unsupported SSH filename search without falling back to local IO", async () => {
  await render({
    kind: "ssh",
    root: "/repo",
    sessionId: 1,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  });
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(io.invoke).not.toHaveBeenCalled();
  expect(node.textContent).toContain(
    "This action is unavailable for this filesystem.",
  );
});

it("does not publish a late result from a replaced search root", async () => {
  let finish!: (result: { hits: unknown[]; truncated: boolean }) => void;
  io.invoke
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({
      hits: [
        {
          path: "/current/new.ts",
          rel: "new.ts",
          name: "new.ts",
          is_dir: false,
        },
      ],
      truncated: false,
    });
  await render();
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await render({ kind: "local" }, "/current");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () =>
    finish({
      hits: [
        { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
      ],
      truncated: false,
    }),
  );
  expect(node.textContent).toContain("new.ts");
  expect(node.textContent).not.toContain("old.ts");
});

it("withdraws accepted results before a replacement root finishes searching", async () => {
  const original = vi.fn();
  const replacement = vi.fn();
  let finish!: (result: { hits: unknown[]; truncated: boolean }) => void;
  io.invoke
    .mockResolvedValueOnce({
      hits: [
        { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
      ],
      truncated: false,
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await render({ kind: "local" }, "/repo", original);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(node.textContent).toContain("old.ts");
  await render({ kind: "local" }, "/current", replacement);
  const stale = [...node.querySelectorAll("button")].find(
    (button) => button.title === "/repo/old.ts",
  );
  await act(async () => {
    stale?.click();
  });
  expect(replacement).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain("old.ts");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(node.textContent).not.toContain("old.ts");
  await act(async () => finish({ hits: [], truncated: false }));
});

it("permanently retires cached result menus across a filesystem round trip", async () => {
  const opened = vi.fn();
  io.invoke.mockResolvedValueOnce({
    hits: [
      { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
    ],
    truncated: false,
  });
  await render({ kind: "local" }, "/repo", opened);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(node.textContent).toContain("old.ts");
  const actions = [...io.menuActions];
  expect(actions.length).toBeGreaterThan(0);
  await render({
    kind: "ssh",
    root: "/repo",
    sessionId: 1,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  });
  await render({ kind: "local" }, "/repo", opened);
  io.invoke.mockClear();
  await act(async () => {
    for (const action of actions) action();
  });
  expect(opened).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain("old.ts");
});

it("retires accepted results and their menus as soon as the query changes", async () => {
  const opened = vi.fn();
  io.invoke.mockResolvedValue({
    hits: [
      { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
    ],
    truncated: false,
  });
  await render({ kind: "local" }, "/repo", opened);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const actions = [...io.menuActions];
  expect(node.textContent).toContain("old.ts");
  await act(async () => {
    actions[0]();
  });
  expect(opened).toHaveBeenCalledWith("/repo/old.ts");
  opened.mockClear();
  await act(async () => {
    io.change?.("other");
  });
  expect(node.textContent).not.toContain("old.ts");
  await act(async () => {
    for (const action of actions) action();
  });
  expect(opened).not.toHaveBeenCalled();
});

it("retires cached result menus when search closes", async () => {
  const opened = vi.fn();
  io.invoke.mockResolvedValue({
    hits: [
      { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
    ],
    truncated: false,
  });
  await render({ kind: "local" }, "/repo", opened);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const actions = [...io.menuActions];
  expect(actions.length).toBeGreaterThan(0);
  await render({ kind: "local" }, "/repo", opened, false);
  io.invoke.mockClear();
  await act(async () => {
    for (const action of actions) action();
  });
  expect(opened).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain("old.ts");
});
