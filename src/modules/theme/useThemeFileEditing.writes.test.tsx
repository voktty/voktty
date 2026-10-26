// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useThemeFileEditing } from "@/modules/theme/useThemeFileEditing";
import { useWorkspaceEnvStore } from "@/modules/workspace";
const io = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: io.listen }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/theme/customThemes", () => ({
  saveCustomTheme: io.save,
  listCustomThemes: async () => [],
}));
vi.mock("@/modules/theme/themeFiles", () => ({
  isThemeFilePath: (path: string) => path.endsWith(".voktty-theme"),
  parseThemeFile: (text: string) => ({ ok: true, theme: { id: text } }),
  onThemeEdit: async () => () => {},
}));
let root: Root;
let node: HTMLDivElement;
let callback: (event: { payload: unknown }) => void;
const tabsRef = { current: [] };
const open = () => {};
function Reader() {
  useThemeFileEditing({ tabsRef, openFileTab: open });
  return null;
}
const event = (filesystem: object = { kind: "local" }) => ({
  payload: { path: "/work/custom.voktty-theme", filesystem, source: "editor" },
});
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  io.listen.mockImplementation(async (_name, handler) => {
    callback = handler;
    return () => {};
  });
  io.invoke.mockResolvedValue({ kind: "text", content: "theme" });
  io.save.mockResolvedValue(undefined);
  node = document.createElement("div");
  root = createRoot(node);
  await act(async () => root.render(<Reader />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("reads local theme saves with local IO independently of the selected SSH environment", async () => {
  useWorkspaceEnvStore.setState({
    env: {
      kind: "ssh",
      root: "/work",
      connection: { id: "fixture", name: "Fixture", host: "example.test" },
    },
  });
  await act(async () => callback(event()));
  expect(io.invoke).toHaveBeenCalledWith("fs_read_file", {
    path: "/work/custom.voktty-theme",
    workspace: { kind: "local" },
  });
  expect(io.save).toHaveBeenCalledWith({ id: "theme" });
});
it("ignores WSL and unqualified saves", async () => {
  await act(async () => {
    callback(event({ kind: "wsl", distro: "first" }));
    callback({
      payload: { path: "/work/custom.voktty-theme", source: "editor" },
    });
  });
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.save).not.toHaveBeenCalled();
});
it("does not persist a read after its owner unmounts", async () => {
  let finish!: (value: object) => void;
  io.invoke.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => callback(event()));
  await act(async () => root.render(null));
  await act(async () => finish({ kind: "text", content: "retired" }));
  expect(io.save).not.toHaveBeenCalled();
});
it("drops an older read and saves the latest queued theme", async () => {
  let finish!: (value: object) => void;
  io.invoke
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ kind: "text", content: "new" });
  await act(async () => callback(event()));
  await act(async () => callback(event()));
  await act(async () => finish({ kind: "text", content: "old" }));
  expect(io.save).toHaveBeenCalledOnce();
  expect(io.save).toHaveBeenCalledWith({ id: "new" });
});

it("serializes a later read behind an already admitted theme persistence", async () => {
  let finish!: () => void;
  io.save.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  io.invoke
    .mockResolvedValueOnce({ kind: "text", content: "old" })
    .mockResolvedValue({ kind: "text", content: "new" });
  await act(async () => callback(event()));
  expect(io.save).toHaveBeenCalledWith({ id: "old" });
  await act(async () => callback(event()));
  expect(io.invoke).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(io.save.mock.calls).toEqual([[{ id: "old" }], [{ id: "new" }]]);
});
