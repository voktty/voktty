// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  useWorkspaceFiles,
  type WorkspaceFilesState,
} from "@/modules/ai/hooks/useWorkspaceFiles";
import type { FileCitationSource } from "@/modules/ai/store/chatStore";
import { useWorkspaceEnvStore } from "@/modules/workspace";

const io = vi.hoisted(() => ({ invoke: vi.fn(), remoteReadDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote", () => ({ remoteReadDir: io.remoteReadDir }));
let root: Root | null = null;
let state: WorkspaceFilesState;
function Probe({ source }: { source: FileCitationSource }) {
  state = useWorkspaceFiles(source, "", true);
  return null;
}
async function render(source: FileCitationSource) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root ??= createRoot(document.createElement("div"));
  await act(async () => root?.render(createElement(Probe, { source })));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  io.invoke.mockReset();
  io.remoteReadDir.mockReset();
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  vi.unstubAllGlobals();
});

it("uses the declared local filesystem independently of the selected WSL workspace", async () => {
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "unrelated" } });
  io.invoke.mockResolvedValue({ files: ["local.ts"], truncated: false });
  await render({
    kind: "local",
    root: "/citation-local",
    workspace: { kind: "local" },
  });
  expect(io.invoke).toHaveBeenCalledWith(
    "fs_list_files",
    expect.objectContaining({
      root: "/citation-local",
      workspace: { kind: "local" },
    }),
  );
  expect(state.files).toEqual(["local.ts"]);
});

it("never reads a root without a declared filesystem or an unresolved namespace", async () => {
  io.invoke.mockResolvedValue({ files: ["wrong.ts"], truncated: false });
  await render({ kind: "local", root: "/citation-unqualified" });
  expect(state.hasWorkspace).toBe(false);
  expect(io.invoke).not.toHaveBeenCalled();
  await render({
    kind: "local",
    root: "remote://unknown/repo",
    workspace: { kind: "local" },
  });
  expect(state.hasWorkspace).toBe(false);
  expect(io.invoke).not.toHaveBeenCalled();
});

it("discards an older filesystem result after source replacement", async () => {
  let finish!: (value: { files: string[]; truncated: boolean }) => void;
  io.invoke
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ files: ["current.ts"], truncated: false });
  await render({
    kind: "local",
    root: "/citation-before",
    workspace: { kind: "local" },
  });
  await render({
    kind: "local",
    root: "/citation-after",
    workspace: { kind: "local" },
  });
  await act(async () => finish({ files: ["retired.ts"], truncated: false }));
  expect(state.files).toEqual(["current.ts"]);
});

it("uses the authenticated SSH reader and isolates same-root hosts", async () => {
  io.remoteReadDir.mockImplementation(async (workspace) => [
    {
      name: `${workspace.connection.host}.ts`,
      path: "/irrelevant",
      kind: "file",
    },
  ]);
  const workspace = {
    kind: "ssh" as const,
    root: "/citation-ssh",
    sessionId: 1,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  };
  await render({ kind: "local", root: "/citation-ssh", workspace });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(state.files).toEqual(["a.test.ts"]);
  await render({
    kind: "local",
    root: "/citation-ssh",
    workspace: {
      ...workspace,
      connection: { ...workspace.connection, host: "b.test" },
    },
  });
  expect(state.files).toEqual(["b.test.ts"]);
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.remoteReadDir).toHaveBeenCalledTimes(2);
});
