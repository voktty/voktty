// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownPreviewPane } from "@/modules/markdown/MarkdownPreviewPane";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  read: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/filesystem", async (original) => ({
  ...(await original<typeof import("@/modules/remote/filesystem")>()),
  remoteReadDocument: io.read,
}));
vi.mock("streamdown", () => ({
  defaultRehypePlugins: {},
  Streamdown: ({ children }: { children: ReactNode }) => (
    <article>{children}</article>
  ),
}));
vi.mock("@/components/ai-elements/markdown-code", () => ({
  MarkdownCode: () => null,
}));
vi.mock("@/components/ui/context-menu", () => {
  const Container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return Object.fromEntries(
    [
      "ContextMenu",
      "ContextMenuContent",
      "ContextMenuItem",
      "ContextMenuSeparator",
      "ContextMenuSub",
      "ContextMenuSubContent",
      "ContextMenuSubTrigger",
      "ContextMenuTrigger",
    ].map((name) => [name, Container]),
  );
});

const path = "remote://voktty-ssh-fixture/srv/project/readme.md";
let root: Root;
let node: HTMLDivElement;
const text = (content: string) => ({
  kind: "text",
  content,
  size: content.length,
  mtime: 1,
});
function pane(target = path, workspace: WorkspaceEnv = LOCAL_WORKSPACE) {
  return (
    <MarkdownPreviewPane
      path={target}
      workspaceEnv={workspace}
      visible
      onSetView={() => {}}
    />
  );
}
async function render(target = path, workspace?: WorkspaceEnv) {
  await act(async () => root.render(pane(target, workspace)));
}
async function rendered(content: string) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(node.querySelector("article")?.textContent).toBe(content);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Fixture",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({
    sshConnections: [{ id: "fixture", name: "Fixture", host: "host-a" }],
  });
  io.acquire.mockResolvedValue({
    info: { session_id: 7, workspace_root: "/srv/project" },
    release: io.release,
  });
  io.read.mockResolvedValue(text("# Remote Markdown"));
  io.invoke.mockRejectedValue(new Error("namespace sent to native IO"));
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("renders saved SSH project Markdown through an owned helper instead of native IO", async () => {
  await render();
  await rendered("# Remote Markdown");
  expect(io.read).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 7, root: "/srv/project" }),
    "/srv/project/readme.md",
    false,
  );
  expect(io.release).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("discards a retired read while retaining its lease until actual settlement", async () => {
  let finish!: (value: ReturnType<typeof text>) => void;
  io.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await vi.waitFor(() => expect(io.read).toHaveBeenCalledOnce());
  expect(io.release).not.toHaveBeenCalled();
  io.invoke.mockResolvedValue(text("Local successor"));
  await render("/work/readme.md");
  await rendered("Local successor");
  await act(async () => finish(text("Retired remote content")));
  expect(node.querySelector("article")?.textContent).toBe("Local successor");
  expect(io.release).toHaveBeenCalledOnce();
});

it("does not read after retirement during helper acquisition", async () => {
  let finish!: (lease: {
    info: { session_id: number; workspace_root: string };
    release: () => void;
  }) => void;
  io.acquire.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await vi.waitFor(() => expect(io.acquire).toHaveBeenCalledOnce());
  await act(async () => root.render(null));
  await act(async () =>
    finish({
      info: { session_id: 7, workspace_root: "/srv/project" },
      release: io.release,
    }),
  );
  expect(io.read).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
});

it("fails closed for an unavailable saved profile", async () => {
  usePreferencesStore.setState({ sshConnections: [] });
  await render();
  await vi.waitFor(() =>
    expect(node.textContent).toContain("saved SSH connection"),
  );
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("does not route a failed helper read to native IO", async () => {
  io.read.mockRejectedValue(new Error("connection lost"));
  await render();
  await vi.waitFor(() => expect(node.textContent).toContain("connection lost"));
  expect(io.release).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("survives StrictMode without reading under the retired effect", async () => {
  await act(async () => root.render(<StrictMode>{pane()}</StrictMode>));
  await rendered("# Remote Markdown");
  expect(io.read).toHaveBeenCalledOnce();
  expect(io.acquire).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("preserves explicit WSL document routing", async () => {
  io.invoke.mockResolvedValue(text("WSL Markdown"));
  await render("/work/readme.md", { kind: "wsl", distro: "Fixture" });
  await rendered("WSL Markdown");
  expect(io.invoke).toHaveBeenCalledWith("fs_read_file", {
    path: "/work/readme.md",
    workspace: { kind: "wsl", distro: "Fixture" },
  });
  expect(io.acquire).not.toHaveBeenCalled();
});

it("retains explicit SSH transport for host paths", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    connection: { id: "other", name: "Other", host: "host-b" },
    root: "/work",
    sessionId: 9,
  };
  await render("/work/readme.md", workspace);
  await rendered("# Remote Markdown");
  expect(io.read).toHaveBeenCalledWith(workspace, "/work/readme.md", false);
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([
  [{ kind: "binary", size: 10 }, "binary"],
  [
    { kind: "toolarge", size: 20_000_000, limit: 10_000_000 },
    "20000000 bytes; limit 10000000",
  ],
])("preserves bounded reader classification: %j", async (result, message) => {
  io.read.mockResolvedValue(result);
  await render();
  await vi.waitFor(() =>
    expect(node.textContent?.toLowerCase()).toContain(message),
  );
  expect(node.querySelector("article")).toBeNull();
  expect(io.release).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("never falls through to native IO for an unregistered namespace", async () => {
  localStorage.clear();
  await render();
  await vi.waitFor(() =>
    expect(node.textContent).toContain("outside a saved remote project"),
  );
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});
