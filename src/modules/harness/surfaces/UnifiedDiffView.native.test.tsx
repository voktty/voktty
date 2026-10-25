// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnifiedDiffView } from "@/modules/harness/surfaces/UnifiedDiffView";
import type { ExplorerMenuItem } from "@/modules/harness/chrome/ExplorerMenu";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  reveal: vi.fn(async () => {}),
  pick: (_action: string) => {},
  windows: false,
}));
vi.mock("@/modules/harness/lib/platform", () => ({
  get IS_WIN() {
    return mocks.windows;
  },
  IS_MAC: false,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: mocks.open }));
vi.mock("@/modules/harness/lib/fs", () => ({
  basename: (path: string) => path.split(/[/\\]/).pop(),
  revealPath: mocks.reveal,
}));
vi.mock("@/modules/harness/surfaces/syntaxTokens", () => ({
  highlightDiffFile: async () => null,
}));
vi.mock("@/modules/harness/hooks/useColorScheme", () => ({
  useColorScheme: () => "dark",
}));
vi.mock("@/modules/harness/chrome/ExplorerMenu", () => ({
  ExplorerMenu: ({
    items,
    onPick,
  }: {
    items: ExplorerMenuItem[];
    onPick: (action: string) => void;
  }) => {
    mocks.pick = onPick;
    return (
      <>
        {items.map((item) =>
          item.kind === "item" ? (
            <button
              type="button"
              key={item.id}
              data-action={item.id}
              disabled={item.disabled}
              title={item.description}
              onClick={() => onPick(item.id)}
            >
              {item.label}
            </button>
          ) : null,
        )}
      </>
    );
  },
}));
let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.open.mockClear();
  mocks.reveal.mockClear();
  mocks.windows = false;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
async function menu(
  path: string,
  repoRoot: string | undefined,
  workspaceEnv: WorkspaceEnv,
) {
  await act(async () =>
    root.render(
      <UnifiedDiffView
        files={[
          {
            id: "file",
            path,
            label: "file",
            additions: 0,
            deletions: 0,
            blocks: [],
          },
        ]}
        repoRoot={repoRoot}
        workspaceEnv={workspaceEnv}
      />,
    ),
  );
  const header = node.querySelector("header");
  if (!header) throw new Error("Missing diff header");
  await act(async () =>
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
  );
}
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  connection: { id: "build", name: "Build", host: "build.example" },
};
it.each<[string, string | undefined, WorkspaceEnv]>([
  ["file.ts", "/project", ssh],
  ["file.ts", "/project", { kind: "wsl", distro: "Ubuntu" }],
  [
    "file.ts",
    "/project",
    {
      kind: "docker",
      connection: { containerId: "box", containerName: "box", image: "image" },
    },
  ],
  ["file.ts", "/project", { kind: "serial", portName: "COM1", baudRate: 9600 }],
  ["file.ts", "remote://host/project", LOCAL_WORKSPACE],
  ["remote://host/project/file.ts", "/native", LOCAL_WORKSPACE],
  ["file.ts", undefined, LOCAL_WORKSPACE],
])(
  "refuses native actions for an unsupported diff destination: %s %s",
  async (path, repoRoot, env) => {
    for (const action of ["open-default", "reveal"]) {
      await menu(path, repoRoot, env);
      const button = node.querySelector<HTMLButtonElement>(
        `[data-action="${action}"]`,
      );
      expect(button?.disabled).toBe(true);
      expect(button?.title).toBeTruthy();
      await act(async () => mocks.pick(action));
    }
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
  },
);
it.each<[string, string | undefined, WorkspaceEnv, string]>([
  ["file.ts", "/project", LOCAL_WORKSPACE, "/project/file.ts"],
  ["file.ts", "C:/project", LOCAL_WORKSPACE, "C:/project/file.ts"],
  [
    "\\\\wsl.localhost\\Ubuntu\\project\\file.ts",
    "/other",
    { kind: "wsl", distro: "Ubuntu" },
    "\\\\wsl.localhost\\Ubuntu\\project\\file.ts",
  ],
  [
    "\\\\server\\share\\file.ts",
    "/other",
    LOCAL_WORKSPACE,
    "\\\\server\\share\\file.ts",
  ],
  [
    "C:/project/file.ts",
    "/other",
    { kind: "wsl", distro: "Ubuntu" },
    "C:/project/file.ts",
  ],
])(
  "preserves native absolute destinations: %s",
  async (path, repoRoot, env, expected) => {
    mocks.windows = !expected.startsWith("/");
    await menu(path, repoRoot, env);
    await act(async () => mocks.pick("open-default"));
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(expected);
    await menu(path, repoRoot, env);
    await act(async () => mocks.pick("reveal"));
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(expected);
  },
);

it("keeps an absolute remote namespace intact for internal opening", async () => {
  const open = vi.fn();
  const path = "remote://host/project/file.ts";
  await act(async () =>
    root.render(
      <UnifiedDiffView
        files={[
          {
            id: "file",
            path,
            label: "file",
            additions: 0,
            deletions: 0,
            blocks: [],
          },
        ]}
        repoRoot="/native"
        onOpenFile={open}
      />,
    ),
  );
  await act(async () =>
    node
      .querySelector("header")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
  );
  await act(async () => mocks.pick("open-file"));
  expect(open).toHaveBeenCalledExactlyOnceWith(path);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.reveal).not.toHaveBeenCalled();
});
