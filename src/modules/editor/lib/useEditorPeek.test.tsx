// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditorPeek } from "@/modules/editor/lib/useEditorPeek";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  peek: vi.fn(),
  open: vi.fn(),
  invoke: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/modules/lsp", () => ({
  lspPeek: io.peek,
  lspOpenPeekItem: io.open,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("sonner", () => ({
  toast: { info: io.info, error: io.error, warning: io.warning },
}));
const item = {
  uri: "file:///work/target.ts",
  path: "/work/target.ts",
  line: 0,
  character: 0,
  label: "target",
};
const ready = { status: "ready", items: [item], truncated: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root;
let node: HTMLDivElement;
let state: EditorState;
let view: EditorView;
let actions: ReturnType<typeof useEditorPeek>;
function Reader({
  workspace = LOCAL_WORKSPACE,
  path = "/work/source.ts",
}: {
  workspace?: WorkspaceEnv;
  path?: string;
}) {
  actions = useEditorPeek(path, workspace, () => view);
  return null;
}
async function render(workspace = LOCAL_WORKSPACE, path?: string) {
  await act(async () =>
    root.render(<Reader workspace={workspace} path={path} />),
  );
}
async function request() {
  await act(async () => actions.request("definition"));
}
function panel() {
  const value = actions.panel;
  if (!value) throw new Error("Expected an active Peek panel.");
  return value;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  io.peek.mockResolvedValue(ready);
  io.open.mockResolvedValue(true);
  io.invoke.mockImplementation(async (command: string) =>
    command === "fs_stat"
      ? { kind: "file", size: 6, mtime: 1 }
      : { kind: "text", content: "target", size: 6, mtime: 1 },
  );
  state = EditorState.create({ doc: "unsaved" });
  view = {
    get state() {
      return state;
    },
    focus: vi.fn(),
  } as unknown as EditorView;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("reads with the source filesystem and reuses its bounded source cache", async () => {
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "original" };
  await render(workspace);
  await request();
  expect(actions.panel?.document).toMatchObject({
    status: "ready",
    excerpt: { content: "target" },
  });
  expect(io.invoke).toHaveBeenCalledWith(
    "fs_read_file",
    expect.objectContaining({ workspace }),
  );
  await request();
  expect(io.invoke).toHaveBeenCalledTimes(2);
});

it("reads the unsaved source buffer without filesystem IO", async () => {
  io.peek.mockResolvedValue({
    ...ready,
    items: [{ ...item, path: "/work/source.ts" }],
  });
  await render();
  await request();
  expect(actions.panel?.document).toMatchObject({
    status: "ready",
    excerpt: { content: "unsaved" },
  });
  expect(io.invoke).not.toHaveBeenCalled();
});

it("does not reuse same-path content from a previous filesystem", async () => {
  await render({ kind: "wsl", distro: "first" });
  await request();
  await render({ kind: "wsl", distro: "second" });
  expect(actions.panel).toBeNull();
  await request();
  expect(io.invoke).toHaveBeenCalledTimes(4);
  expect(io.invoke).toHaveBeenLastCalledWith(
    "fs_read_file",
    expect.objectContaining({ workspace: { kind: "wsl", distro: "second" } }),
  );
});

it("retires pending LSP results across a source round trip", async () => {
  const pending = deferred<typeof ready>();
  io.peek.mockReturnValue(pending.promise);
  await render();
  let work!: Promise<void>;
  await act(async () => {
    work = actions.request("definition");
  });
  const current = io.peek.mock.calls[0][2] as () => boolean;
  await render(LOCAL_WORKSPACE, "/work/other.ts");
  await render();
  expect(current()).toBe(false);
  await act(async () => {
    pending.resolve(ready);
    await work;
  });
  expect(actions.panel).toBeNull();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("keeps the newer request when LSP replies arrive out of order", async () => {
  const pending = deferred<typeof ready>();
  io.peek.mockReturnValueOnce(pending.promise);
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = actions.request("definition");
  });
  await act(async () => actions.request("references"));
  await act(async () => {
    pending.resolve(ready);
    await first;
  });
  expect(actions.panel?.kind).toBe("references");
});

it("stops before content IO if closed while stat is pending", async () => {
  const pending = deferred<{ kind: string; size: number }>();
  io.invoke.mockReturnValue(pending.promise);
  await render();
  await request();
  const previous = panel();
  await act(async () => previous.onClose());
  await act(async () => {
    pending.resolve({ kind: "file", size: 6 });
  });
  expect(actions.panel).toBeNull();
  expect(io.invoke).toHaveBeenCalledOnce();
});

it("rejects old panel callbacks after replacement", async () => {
  await render();
  await request();
  const previous = panel();
  await request();
  await act(async () => {
    previous.onSelect(0);
    previous.onClose();
    await previous.onOpen(item);
  });
  expect(actions.panel).not.toBeNull();
  expect(io.open).not.toHaveBeenCalled();
});

it("retires an open action before its lazy navigation stage", async () => {
  const pending = deferred<boolean>();
  io.open.mockReturnValue(pending.promise);
  await render();
  await request();
  let work!: Promise<void>;
  await act(async () => {
    work = panel().onOpen(item);
  });
  const current = io.open.mock.calls[0][2] as () => boolean;
  await render(LOCAL_WORKSPACE, "/work/other.ts");
  expect(current()).toBe(false);
  await act(async () => {
    pending.resolve(false);
    await work;
  });
  expect(io.info).not.toHaveBeenCalled();
});

it("does not publish after the buffer changes during an LSP request", async () => {
  const pending = deferred<typeof ready>();
  io.peek.mockReturnValue(pending.promise);
  await render();
  let work!: Promise<void>;
  await act(async () => {
    work = actions.request("definition");
  });
  state = state.update({ changes: { from: 0, insert: "edit" } }).state;
  await act(async () => {
    pending.resolve(ready);
    await work;
  });
  expect(actions.panel).toBeNull();
});

it("retires cached actions on unmount", async () => {
  await render();
  await request();
  const previous = panel();
  await act(async () => root.render(null));
  await act(async () => previous.onOpen(item));
  expect(io.open).not.toHaveBeenCalled();
});

it("survives StrictMode ownership replacement", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Reader />
      </StrictMode>,
    ),
  );
  await request();
  expect(actions.panel?.document.status).toBe("ready");
});

it("does not focus the editor from a close frame after a newer Peek request", async () => {
  let frame!: FrameRequestCallback;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  await render();
  await request();
  await act(async () => panel().onClose());
  await request();
  frame(0);
  expect(view.focus).not.toHaveBeenCalled();
});

it("keeps retired LSP requests charged until they settle", async () => {
  const pending = deferred<typeof ready>();
  io.peek.mockReturnValue(pending.promise);
  await render();
  let work!: Promise<void>[];
  await act(async () => {
    work = Array.from({ length: 256 }, () => actions.request("definition"));
  });
  await act(async () => actions.dismiss());
  await request();
  expect(io.peek).toHaveBeenCalledTimes(256);
  await act(async () => {
    pending.resolve(ready);
    await Promise.all(work);
  });
  expect(actions.panel).toBeNull();
  io.peek.mockResolvedValue(ready);
  await request();
  expect(io.peek).toHaveBeenCalledTimes(257);
  expect(actions.panel?.document.status).toBe("ready");
});

it("does not read after the originating LSP binding retires", async () => {
  let bound = true;
  const pending = deferred<{ kind: string; size: number }>();
  io.peek.mockResolvedValue({ ...ready, isCurrent: () => bound });
  io.invoke.mockReturnValue(pending.promise);
  await render();
  await request();
  bound = false;
  await act(async () => {
    pending.resolve({ kind: "file", size: 6 });
  });
  expect(io.invoke).toHaveBeenCalledOnce();
  expect(io.open).not.toHaveBeenCalled();
});
