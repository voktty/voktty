// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConflictResolverDialog } from "@/modules/source-control/ConflictResolverDialog";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRead: vi.fn(),
  remoteWrite: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/modules/remote", async (original) => ({
  ...(await original<typeof import("@/modules/remote")>()),
  remoteReadFile: mocks.remoteRead,
  remoteWriteFile: mocks.remoteWrite,
}));
const content = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n";
const local: WorkspaceEnv = { kind: "local" };
let root: Root;
let node: HTMLDivElement;
const resolved = vi.fn();
const closed = vi.fn();
async function render(open = true, workspace = local, path = "a.ts") {
  await act(async () =>
    root.render(
      <ConflictResolverDialog
        open={open}
        repoRoot="/repo"
        path={path}
        workspace={workspace}
        onResolved={resolved}
        onOpenChange={closed}
      />,
    ),
  );
}
async function click(label: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: local });
  mocks.invoke
    .mockReset()
    .mockImplementation(async (command) =>
      command === "fs_read_file"
        ? { kind: "text", content, size: content.length }
        : undefined,
    );
  mocks.remoteRead
    .mockReset()
    .mockResolvedValue({ content, size: content.length, mtime: 1 });
  mocks.remoteWrite.mockReset().mockResolvedValue(1);
  mocks.success.mockReset();
  mocks.error.mockReset();
  resolved.mockReset();
  closed.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  useWorkspaceEnvStore.setState({ env: local });
  vi.unstubAllGlobals();
});
it("uses the dialog's explicit filesystem instead of the ambient environment", async () => {
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ambient" } });
  const ssh: WorkspaceEnv = {
    kind: "ssh",
    root: "/repo",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  await render(true, ssh);
  expect(mocks.remoteRead).toHaveBeenCalledWith(ssh, "/repo/a.ts");
  expect(
    mocks.invoke.mock.calls.some(([command]) => command === "fs_read_file"),
  ).toBe(false);
});
it("never stages a write whose dialog retired while it was pending", async () => {
  let finish!: () => void;
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "fs_read_file")
      return { kind: "text", content, size: content.length };
    if (command === "fs_write_file")
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  await render();
  await click("Ours");
  await click("Mark resolved");
  await render(false);
  await act(async () => finish());
  expect(
    mocks.invoke.mock.calls.some(([command]) => command === "git_stage"),
  ).toBe(false);
  expect(mocks.success).not.toHaveBeenCalled();
  expect(resolved).not.toHaveBeenCalled();
});
it("refuses to replace conflict content changed since it was loaded", async () => {
  await render();
  await click("Ours");
  mocks.invoke.mockImplementation(async (command) =>
    command === "fs_read_file"
      ? { kind: "text", content: "external edit", size: 13 }
      : undefined,
  );
  await click("Mark resolved");
  expect(
    mocks.invoke.mock.calls.some(
      ([command]) => command === "fs_write_file" || command === "git_stage",
    ),
  ).toBe(false);
  expect(mocks.error).toHaveBeenCalledOnce();
});

it("retries a failed stage without repeating an acknowledged file write", async () => {
  let disk = content;
  let stages = 0;
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "fs_read_file")
      return { kind: "text", content: disk, size: disk.length };
    if (command === "fs_write_file") {
      disk = args.content;
      return 1;
    }
    if (command === "git_stage" && stages++ === 0)
      throw new Error("Stage refused");
  });
  await render();
  await click("Ours");
  await click("Mark resolved");
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(resolved).not.toHaveBeenCalled();
  await click("Mark resolved");
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "fs_write_file"),
  ).toHaveLength(1);
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "git_stage"),
  ).toHaveLength(2);
  expect(resolved).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledExactlyOnceWith(false);
});
it("does not display old conflict choices beneath a replacement file title", async () => {
  await render();
  mocks.invoke.mockImplementation(async (command) =>
    command === "fs_read_file" ? new Promise(() => {}) : undefined,
  );
  await render(true, local, "b.ts");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "b.ts",
  );
  expect(document.querySelector("pre")).toBeNull();
});
it.each<WorkspaceEnv>([
  { kind: "serial", portName: "port", baudRate: 9600 },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])(
  "shows unsupported $kind conflict IO without a local fallback",
  async (workspace) => {
    await render(true, workspace);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "This action is unavailable for this filesystem.",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.remoteRead).not.toHaveBeenCalled();
  },
);
it("does not let duplicate immediate submits issue two writes or stages", async () => {
  let disk = content;
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "fs_read_file")
      return { kind: "text", content: disk, size: disk.length };
    if (command === "fs_write_file") disk = args.content;
  });
  await render();
  await click("Ours");
  const submit = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === "Mark resolved");
  await act(async () => {
    submit?.click();
    submit?.click();
  });
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "fs_write_file"),
  ).toHaveLength(1);
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "git_stage"),
  ).toHaveLength(1);
});
