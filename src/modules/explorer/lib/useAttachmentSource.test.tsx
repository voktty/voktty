// @vitest-environment happy-dom
import {
  act,
  createElement,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAttachmentSource } from "@/modules/explorer/lib/useAttachmentSource";
import {
  useExplorerDnd,
  type ExplorerPathDropTarget,
} from "@/modules/explorer/lib/useExplorerDnd";
import type { WorkspaceEnv } from "@/modules/workspace";

let root: Root;
let node: HTMLDivElement;
let source: ReturnType<typeof useAttachmentSource>;
let drag: ReturnType<typeof useExplorerDnd>;
const send = vi.fn();
const drop = vi.fn<NonNullable<ExplorerPathDropTarget["dropExplorerPath"]>>(
  () => true,
);
const onMove = vi.fn();
const target = {
  updateTarget: () => true,
  dropPath: vi.fn(() => true),
  dropExplorerPath: drop,
  clearTarget: vi.fn(),
};
const local: WorkspaceEnv = { kind: "local" };
function Probe({
  scope,
  workspace,
  selected,
}: {
  scope: object;
  workspace: WorkspaceEnv;
  selected?: Set<string>;
}) {
  source = useAttachmentSource(scope, workspace, send);
  drag = useExplorerDnd({
    rootPath: "/repo",
    isDir: () => false,
    onMove,
    pathDropTarget: target,
    selectedPaths: selected,
    captureSource: source.capture,
  });
  return createElement("div", { "data-fs-path": "/repo/a.ts" });
}
async function render(
  scope: object,
  workspace = local,
  selected?: Set<string>,
) {
  await act(async () =>
    root.render(createElement(Probe, { scope, workspace, selected })),
  );
}
function begin() {
  const row = node.querySelector("[data-fs-path]");
  drag.onPointerDown({
    button: 0,
    target: row,
    clientX: 0,
    clientY: 0,
  } as unknown as ReactPointerEvent);
  window.dispatchEvent(
    new MouseEvent("pointermove", { clientX: 20, clientY: 20 }),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  node = document.createElement("div");
  root = createRoot(node);
  send.mockClear();
  drop.mockClear();
  onMove.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps captured filesystem and old callbacks retired across a scope round trip", async () => {
  const scope = {};
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/repo",
    sessionId: 1,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  };
  await render(scope, workspace);
  const original = source.attach;
  const captured = source.capture();
  await render({}, local);
  await render(scope, workspace);
  original("/repo/a.ts");
  expect(send).not.toHaveBeenCalled();
  expect(captured?.isCurrent()).toBe(false);
  source.attach("/repo/a.ts");
  expect(send).toHaveBeenCalledWith(
    "/repo/a.ts",
    workspace,
    expect.any(Function),
  );
});

it("uses the selection captured before dragging instead of the later selection", async () => {
  const scope = {};
  await render(scope, local, new Set(["/repo/a.ts", "/repo/b.ts"]));
  await act(async () => begin());
  await render(scope, local, new Set(["/repo/a.ts", "/repo/c.ts"]));
  await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
  expect(drop.mock.calls.map((call) => call[0])).toEqual([
    "/repo/a.ts",
    "/repo/b.ts",
  ]);
  expect(drop).toHaveBeenCalledWith(
    "/repo/a.ts",
    20,
    20,
    local,
    expect.any(Function),
  );
  expect(onMove).not.toHaveBeenCalled();
});

it("cancels an old drag after source replacement and never drops into its successor", async () => {
  await render({});
  await act(async () => begin());
  await render({}, { kind: "wsl", distro: "fixture" });
  await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
  expect(drop).not.toHaveBeenCalled();
  expect(onMove).not.toHaveBeenCalled();
  await act(async () => {
    begin();
    window.dispatchEvent(new MouseEvent("pointerup"));
  });
  expect(drop).toHaveBeenCalledExactlyOnceWith(
    "/repo/a.ts",
    20,
    20,
    { kind: "wsl", distro: "fixture" },
    expect.any(Function),
  );
});
