// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLspExtension } from "@/modules/lsp/lib/useLspExtension";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceTextEditRequest } from "@/modules/workspace-edit";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
const acquire = vi.hoisted(() => vi.fn());
vi.mock("@/modules/lsp/lib/sessionManager", () => ({
  acquireDocExtension: acquire,
}));
const extension: never[] = [];
let root: Root;
let node: HTMLDivElement;
let value: ReturnType<typeof useLspExtension>;
let release: ReturnType<typeof vi.fn>;
let callback: ReturnType<
  typeof vi.fn<(request: WorkspaceTextEditRequest) => void>
>;
const seen: unknown[] = [];
function Reader({
  path = "/work/file.ts",
  workspace = LOCAL_WORKSPACE,
}: {
  path?: string;
  workspace?: WorkspaceEnv;
}) {
  value = useLspExtension(path, "ts", true, workspace, callback);
  seen.push(value);
  return null;
}
async function render(path = "/work/file.ts", workspace = LOCAL_WORKSPACE) {
  await act(async () =>
    root.render(<Reader path={path} workspace={workspace} />),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  seen.length = 0;
  release = vi.fn();
  callback = vi.fn();
  acquire.mockResolvedValue({ extension, release });
  usePreferencesStore.setState({
    lspActivation: { typescript: "enabled" },
    lspCustomServers: [],
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("passes the captured document filesystem and caller guard", async () => {
  await render();
  expect(value).toBe(extension);
  expect(acquire).toHaveBeenCalledWith(
    "/work/file.ts",
    "ts",
    { kind: "local" },
    expect.any(Function),
    expect.any(Object),
    expect.any(Function),
  );
});
it("does not expose the previous extension on a same-path filesystem change", async () => {
  await render();
  seen.length = 0;
  await render("/work/file.ts", {
    kind: "ssh",
    root: "/work",
    connection: { id: "a", name: "A", host: "host-a" },
  });
  expect(seen.every((item) => item === null)).toBe(true);
  expect(acquire).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
it("releases a late handle without replacing the successor", async () => {
  let finish!: (handle: { extension: unknown[]; release: () => void }) => void;
  const oldRelease = vi.fn();
  acquire.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await render("/work/next.ts");
  await act(async () => finish({ extension: ["old"], release: oldRelease }));
  expect(value).toBe(extension);
  expect(oldRelease).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
});
it("retires the original callback and guard across a document round trip", async () => {
  await render();
  const forward = acquire.mock.calls[0][3] as (
    request: WorkspaceTextEditRequest,
  ) => void;
  const current = acquire.mock.calls[0][5] as () => boolean;
  await render("/work/next.ts");
  await render();
  expect(current()).toBe(false);
  forward({} as WorkspaceTextEditRequest);
  expect(callback).not.toHaveBeenCalled();
});
it("keeps current callbacks usable without forwarding after unmount", async () => {
  await render();
  const forward = acquire.mock.calls[0][3] as (
    request: WorkspaceTextEditRequest,
  ) => void;
  const request = {} as WorkspaceTextEditRequest;
  forward(request);
  expect(callback).toHaveBeenCalledWith(request);
  await act(async () => root.render(null));
  forward(request);
  expect(callback).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
it("releases the discarded StrictMode handle once", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Reader />
      </StrictMode>,
    ),
  );
  expect(value).toBe(extension);
  expect(acquire).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledOnce();
});
