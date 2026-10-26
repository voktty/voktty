// @vitest-environment happy-dom
import { act, type InputHTMLAttributes, type ChangeEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExplorerSearch } from "@/modules/explorer/ExplorerSearch";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  change: null as ((value: string) => void) | null,
}));
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
) {
  await act(async () =>
    root.render(
      <ExplorerSearch
        rootPath={path}
        workspace={workspace}
        open
        onRequestClose={() => {}}
        onOpenFile={() => {}}
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
