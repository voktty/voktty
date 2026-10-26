// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { useEditorFileSync } from "@/modules/editor/useEditorFileSync";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: async () => () => {} }),
}));
vi.mock("@/modules/explorer/lib/watch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/explorer/lib/watch")>()),
  watchAdd: io.add,
  watchRemove: io.remove,
  listenFsChanged: io.listen,
}));

let root: Root;
let node: HTMLDivElement;
let tabsRef: { current: Tab[] };
let editorRefs: { current: Map<number, EditorPaneHandle> };
let subscriptions: Array<{
  callback: (paths: string[]) => void;
  workspace: WorkspaceEnv;
  unlisten: ReturnType<typeof vi.fn>;
}>;
function editor(id: number, path: string, workspaceEnv?: WorkspaceEnv): Tab {
  return { id, kind: "editor", path, workspaceEnv } as Tab;
}
function Reader({ workspace = LOCAL_WORKSPACE }: { workspace?: WorkspaceEnv }) {
  useEditorFileSync({ tabs: tabsRef.current, tabsRef, editorRefs, workspace });
  return null;
}
function handle(id: number) {
  const value = { notifyExternalChange: vi.fn(), reload: vi.fn() };
  editorRefs.current.set(id, value as unknown as EditorPaneHandle);
  return value;
}
async function mount(workspace: WorkspaceEnv = LOCAL_WORKSPACE) {
  await act(async () => root.render(<Reader workspace={workspace} />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  subscriptions = [];
  io.listen.mockImplementation(async (callback, workspace) => {
    const unlisten = vi.fn();
    subscriptions.push({ callback, workspace, unlisten });
    return unlisten;
  });
  tabsRef = { current: [editor(1, "/work/file.ts")] };
  editorRefs = { current: new Map() };
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("watches a legacy local document independently of the ambient WSL selection", async () => {
  const local = handle(1);
  await mount({ kind: "wsl", distro: "Ubuntu" });
  expect(io.add).toHaveBeenCalledWith(["/work"], LOCAL_WORKSPACE);
  expect(subscriptions[0].workspace).toEqual(LOCAL_WORKSPACE);
  subscriptions[0].callback(["/work/file.ts"]);
  expect(local.reload).toHaveBeenCalledWith(false);
  await act(async () => root.render(null));
  expect(io.remove).toHaveBeenCalledWith(["/work"], LOCAL_WORKSPACE);
});

it("ignores callbacks after unmount", async () => {
  const local = handle(1);
  await mount();
  await act(async () => root.render(null));
  subscriptions[0].callback(["/work/file.ts"]);
  expect(local.notifyExternalChange).not.toHaveBeenCalled();
  expect(local.reload).not.toHaveBeenCalled();
  expect(subscriptions[0].unlisten).toHaveBeenCalledOnce();
});

it("does not reload a handle replaced during notification", async () => {
  const local = handle(1);
  local.notifyExternalChange.mockImplementation(() => handle(1));
  await mount();
  subscriptions[0].callback(["/work/file.ts"]);
  expect(local.reload).not.toHaveBeenCalled();
  expect(editorRefs.current.get(1)?.reload).not.toHaveBeenCalled();
});

it("does not reload a tab removed during notification", async () => {
  const local = handle(1);
  local.notifyExternalChange.mockImplementation(() => {
    tabsRef.current = [];
  });
  await mount();
  subscriptions[0].callback(["/work/file.ts"]);
  expect(local.reload).not.toHaveBeenCalled();
});

it("preserves literal backslashes and case in POSIX filenames", async () => {
  tabsRef.current = [editor(1, "/work/name\\part.ts")];
  const local = handle(1);
  await mount();
  expect(io.add).toHaveBeenCalledWith(["/work"], LOCAL_WORKSPACE);
  subscriptions[0].callback(["/work/name/part.ts", "/work/NAME\\part.ts"]);
  expect(local.reload).not.toHaveBeenCalled();
  subscriptions[0].callback(["/work/name\\part.ts"]);
  expect(local.reload).toHaveBeenCalledOnce();
});

it("matches native Windows drive and UNC spellings", async () => {
  tabsRef.current = [
    editor(1, "C:/work/file.ts"),
    editor(2, "//server/share/file.ts"),
  ];
  const drive = handle(1);
  const unc = handle(2);
  await mount();
  subscriptions[0].callback([
    "c:\\WORK\\file.ts",
    "\\\\SERVER\\share\\file.ts",
  ]);
  expect(drive.reload).toHaveBeenCalledWith(false);
  expect(unc.reload).toHaveBeenCalledWith(false);
});

it("retires old subscriptions across a filesystem change and return", async () => {
  const local = handle(1);
  await mount();
  const old = subscriptions[0];
  tabsRef.current = [
    editor(1, "/work/file.ts", { kind: "wsl", distro: "Ubuntu" }),
  ];
  await mount();
  tabsRef.current = [editor(1, "/work/file.ts")];
  await mount();
  old.callback(["/work/file.ts"]);
  expect(local.reload).not.toHaveBeenCalled();
  subscriptions[subscriptions.length - 1]?.callback(["/work/file.ts"]);
  expect(local.reload).toHaveBeenCalledOnce();
});

it("isolates identical host paths by SSH session and WSL distro", async () => {
  const ssh = (sessionId: number): WorkspaceEnv => ({
    kind: "ssh",
    connection: { id: "fixture", name: "Fixture", host: "fixture.invalid" },
    root: "/work",
    sessionId,
  });
  const environments: WorkspaceEnv[] = [
    LOCAL_WORKSPACE,
    { kind: "wsl", distro: "first" },
    { kind: "wsl", distro: "second" },
    ssh(7),
    ssh(8),
  ];
  tabsRef.current = environments.map((workspace, index) =>
    editor(index + 1, "/work/file.ts", workspace),
  );
  const handles = environments.map((_, index) => handle(index + 1));
  await mount();
  expect(subscriptions).toHaveLength(5);
  for (let index = 0; index < subscriptions.length; index++) {
    expect(subscriptions[index].workspace).toEqual(environments[index]);
    subscriptions[index].callback(["/work/file.ts"]);
    expect(handles[index].reload).toHaveBeenCalledOnce();
    handles[index].reload.mockClear();
    for (const target of handles) expect(target.reload).not.toHaveBeenCalled();
  }
});

it("releases a late listener registration without delivering retired events", async () => {
  let register: ((unlisten: () => void) => void) | undefined;
  io.listen.mockImplementationOnce((callback, workspace) => {
    subscriptions.push({ callback, workspace, unlisten: vi.fn() });
    return new Promise<() => void>((resolve) => {
      register = resolve;
    });
  });
  const local = handle(1);
  await mount();
  await act(async () => root.render(null));
  subscriptions[0].callback(["/work/file.ts"]);
  expect(local.reload).not.toHaveBeenCalled();
  const unlisten = vi.fn();
  await act(async () => register?.(unlisten));
  expect(unlisten).toHaveBeenCalledOnce();
});

it("shares a directory watch until its final tab closes", async () => {
  tabsRef.current.push(editor(2, "/work/other.ts"));
  await mount();
  expect(io.add).toHaveBeenCalledWith(["/work"], LOCAL_WORKSPACE);
  io.add.mockClear();
  io.remove.mockClear();
  tabsRef.current = [tabsRef.current[1]];
  await mount();
  expect(io.add.mock.calls.flatMap(([paths]) => paths)).toEqual([]);
  expect(io.remove.mock.calls.flatMap(([paths]) => paths)).toEqual([]);
  await act(async () => root.render(null));
  expect(io.remove).toHaveBeenCalledWith(["/work"], LOCAL_WORKSPACE);
});
