// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "@/modules/harness/chrome/Composer";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  pick: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: io.pick }));
vi.mock("@/modules/harness/chrome/useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: vi.fn() }),
}));
let root: Root, node: HTMLDivElement;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function render(props: Partial<ComponentProps<typeof Composer>> = {}) {
  await act(async () =>
    root.render(
      <Composer
        focused={false}
        harness="codex"
        model=""
        runtimeMode="supervised"
        executionCwd="/project"
        initialDraft="original"
        hideTopBar
        onFocus={vi.fn()}
        onCwdChange={vi.fn()}
        onModelChange={vi.fn()}
        onRuntimeModeChange={vi.fn()}
        onSubmit={io.submit}
        {...props}
      />,
    ),
  );
}
async function click(label: string) {
  const button = node.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}
function pastePath(path = "/project/folder") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const file = Object.assign(
    new File(["fixture"], "folder", { type: "text/plain" }),
    { path },
  );
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => "", files: [file], items: [] },
  });
  const textarea = node.querySelector("textarea");
  if (!textarea) throw new Error("Missing Composer textarea");
  textarea.dispatchEvent(event);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.invoke.mockReset();
  io.pick.mockReset();
  io.submit.mockReset();
  io.invoke.mockImplementation(async (command: string) =>
    command === "inspect_paths"
      ? [{ path: "/project/folder", name: "folder", size: 0, isDir: true }]
      : command === "fs_pick_file"
        ? null
        : [],
  );
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("does not inspect a file picker result after a context round trip", async () => {
  const pending = deferred<string[]>();
  io.pick.mockReturnValue(pending.promise);
  await render();
  await click("Attach files");
  await render({ executionCwd: "/next" });
  await render();
  await act(async () => pending.resolve(["/project/folder"]));
  expect(
    io.invoke.mock.calls.filter(([command]) => command === "inspect_paths"),
  ).toHaveLength(0);
  expect(node.querySelectorAll('button[aria-label^="Remove "]')).toHaveLength(
    0,
  );
});
it.each(["paste", "picker"] as const)(
  "waits for %s attachments before sending the original draft",
  async (kind) => {
    const pending =
      deferred<
        Array<{ path: string; name: string; size: number; isDir: boolean }>
      >();
    io.pick.mockResolvedValue(["/project/folder"]);
    io.invoke.mockImplementation((command: string) =>
      command === "inspect_paths" ? pending.promise : Promise.resolve([]),
    );
    await render();
    if (kind === "paste") await act(async () => pastePath());
    else await click("Attach files");
    await click("Send");
    expect(io.submit).not.toHaveBeenCalled();
    await act(async () =>
      pending.resolve([
        { path: "/project/folder", name: "folder", size: 0, isDir: true },
      ]),
    );
    expect(io.submit).toHaveBeenCalledExactlyOnceWith(
      "original",
      [
        expect.objectContaining({
          path: "/project/folder",
          mimeType: "inode/directory",
        }),
      ],
      undefined,
    );
  },
);
it("discards a pasted directory after the original Composer is disabled and reenabled", async () => {
  const pending =
    deferred<
      Array<{ path: string; name: string; size: number; isDir: boolean }>
    >();
  io.invoke.mockImplementation((command: string) =>
    command === "inspect_paths" ? pending.promise : Promise.resolve([]),
  );
  await render();
  await act(async () => pastePath());
  await render({ enabled: false });
  await render({ enabled: true });
  await act(async () =>
    pending.resolve([
      { path: "/project/folder", name: "folder", size: 0, isDir: true },
    ]),
  );
  expect(node.querySelectorAll('button[aria-label^="Remove "]')).toHaveLength(
    0,
  );
  expect(node.querySelector('[role="alert"]')).toBeNull();
});
it("keeps picker cancellation neutral", async () => {
  io.pick.mockResolvedValue(null);
  await render();
  await click("Attach files");
  expect(node.querySelector('[role="alert"]')).toBeNull();
});

it("pastes message text with empty attachment metadata without an attachment error", async () => {
  await render();
  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/html"
            ? '<div data-monocode-files="%5B%5D"></div>'
            : "pasted text",
      },
    });
    const textarea = node.querySelector("textarea");
    if (!textarea) throw new Error("Missing Composer textarea");
    textarea.dispatchEvent(event);
  });
  expect(node.querySelector("textarea")?.value).toContain("pasted text");
  expect(node.querySelector('[role="alert"]')).toBeNull();
});

function cachedHandler(element: Element, name: string) {
  const key = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!key) throw new Error("Missing React event props");
  return (
    element as unknown as Record<
      string,
      Record<string, (event?: unknown) => void>
    >
  )[key][name];
}
it("does not reopen a picker through a callback retained from a retired context", async () => {
  await render();
  const element = node.querySelector('button[aria-label="Attach files"]');
  if (!element) throw new Error("Missing file picker button");
  const old = cachedHandler(element, "onClick");
  await render({ executionCwd: "/next" });
  await render();
  await act(async () => old());
  expect(io.pick).not.toHaveBeenCalled();
});
it("leaves the draft unsent when a pending paste fails", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_, no) => {
    reject = no;
  });
  io.invoke.mockImplementation((command: string) =>
    command === "inspect_paths" ? pending : Promise.resolve([]),
  );
  await render();
  await act(async () => pastePath());
  await click("Send");
  await act(async () => reject(new Error("private path must not appear")));
  expect(io.submit).not.toHaveBeenCalled();
  expect(node.querySelector("textarea")?.value).toBe("original");
  expect(node.querySelector('[role="alert"]')?.textContent).not.toContain(
    "private path",
  );
});
