// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { useEditorFileSync } from "@/modules/editor/useEditorFileSync";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: io.listen }),
}));
vi.mock("@/modules/explorer/lib/watch", () => ({
  parentDir: () => "/work",
  watchAdd: vi.fn(),
  watchRemove: vi.fn(),
  listenFsChanged: async () => () => {},
}));
let root: Root;
let node: HTMLDivElement;
let callback: (event: { payload: unknown }) => void;
let tabsRef: { current: Tab[] };
let editorRefs: { current: Map<number, EditorPaneHandle> };
function Reader({ workspace = LOCAL_WORKSPACE }: { workspace?: WorkspaceEnv }) {
  useEditorFileSync({
    tabs: tabsRef.current,
    tabsRef,
    editorRefs,
    workspace,
  });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  io.listen.mockImplementation(async (_event, handler) => {
    callback = handler;
    return () => {};
  });
  tabsRef = {
    current: [
      {
        id: 1,
        kind: "editor",
        path: "/work/file.ts",
        workspaceEnv: { kind: "local" },
      },
      {
        id: 2,
        kind: "editor",
        path: "/work/file.ts",
        workspaceEnv: { kind: "wsl", distro: "first" },
      },
      {
        id: 3,
        kind: "editor",
        path: "/work/file.ts",
        workspaceEnv: { kind: "wsl", distro: "second" },
      },
    ] as Tab[],
  };
  editorRefs = {
    current: new Map(
      [1, 2, 3].map((id) => [
        id,
        {
          reload: vi.fn(),
          notifyExternalChange: vi.fn(),
        } as unknown as EditorPaneHandle,
      ]),
    ),
  };
  node = document.createElement("div");
  root = createRoot(node);
  await act(async () => root.render(<Reader />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("notifies only the owning WSL filesystem for an identical path", () => {
  callback({
    payload: {
      path: "/work/file.ts",
      filesystem: { kind: "wsl", distro: "first" },
    },
  });
  expect(editorRefs.current.get(1)?.reload).not.toHaveBeenCalled();
  expect(editorRefs.current.get(2)?.reload).toHaveBeenCalledWith(false);
  expect(editorRefs.current.get(3)?.reload).not.toHaveBeenCalled();
});
it("does not infer a filesystem for an unqualified event", () => {
  callback({ payload: { path: "/work/file.ts" } });
  for (const handle of editorRefs.current.values())
    expect(handle.reload).not.toHaveBeenCalled();
});
it("retires a previously registered callback on unmount", async () => {
  await act(async () => root.render(null));
  callback({
    payload: { path: "/work/file.ts", filesystem: { kind: "local" } },
  });
  for (const handle of editorRefs.current.values())
    expect(handle.reload).not.toHaveBeenCalled();
});

it("keeps legacy editor tabs local even when the ambient fallback is WSL", async () => {
  tabsRef.current.push({ id: 4, kind: "editor", path: "/work/file.ts" } as Tab);
  const reload = vi.fn();
  editorRefs.current.set(4, {
    reload,
    notifyExternalChange: vi.fn(),
  } as unknown as EditorPaneHandle);
  await act(async () =>
    root.render(<Reader workspace={{ kind: "wsl", distro: "second" }} />),
  );
  callback({
    payload: {
      path: "/work/file.ts",
      filesystem: { kind: "wsl", distro: "second" },
    },
  });
  expect(reload).not.toHaveBeenCalled();
});

it("does not reload after notification replaces the captured editor handle", () => {
  const previous = editorRefs.current.get(1);
  if (!previous) throw new Error("Missing editor handle");
  const reload = vi.fn();
  vi.mocked(previous.notifyExternalChange).mockImplementation(() =>
    editorRefs.current.set(1, { reload } as unknown as EditorPaneHandle),
  );
  callback({
    payload: { path: "/work/file.ts", filesystem: { kind: "local" } },
  });
  expect(previous.reload).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
