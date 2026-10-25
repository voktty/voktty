// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaPreview } from "@/modules/editor/MediaPreview";
import { MarkdownImage } from "@/modules/markdown/MarkdownImage";
import { MarkdownDocContext } from "@/modules/markdown/lib/docContext";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
  useWorkspaceEnvStore,
} from "@/modules/workspace";
import { useMediaSource } from "@/modules/editor/lib/useMediaSource";

const io = vi.hoisted(() => ({
  binary: vi.fn(),
  invoke: vi.fn(),
  convert: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: io.invoke,
  convertFileSrc: io.convert,
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/filesystem", async (original) => ({
  ...(await original<typeof import("@/modules/remote/filesystem")>()),
  remoteReadBinaryFile: io.binary,
}));
const path = "remote://voktty-ssh-fixture/srv/project/image.png";
let root: Root;
let node: HTMLDivElement;
const OriginalURL = URL;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = io.create;
      static revokeObjectURL = io.revoke;
    },
  );
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Fixture",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({
    sshConnections: [{ id: "fixture", name: "Fixture", host: "host-a" }],
  });
  io.convert.mockImplementation((target: string) => `asset://${target}`);
  io.create.mockReturnValue("blob:fixture");
  io.acquire.mockResolvedValue({
    info: { session_id: 7, workspace_root: "/srv/project" },
    release: io.release,
  });
  io.binary.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    size: 3,
    mtime: 1,
  });
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
async function blobReady() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(node.querySelector("img")?.getAttribute("src")).toBe("blob:fixture");
  });
}
let media: ReturnType<typeof useMediaSource>;
function Source({
  target = path,
  workspace = LOCAL_WORKSPACE,
}: {
  target?: string;
  workspace?: WorkspaceEnv;
}) {
  media = useMediaSource(target, workspace, "image/png");
  return <img src={media.src} alt="Fixture" />;
}
async function readySource(target = path, workspace?: WorkspaceEnv) {
  await act(async () =>
    root.render(<Source target={target} workspace={workspace} />),
  );
  await blobReady();
}
it("loads namespace media through an owned binary helper without a native asset URL", async () => {
  await act(async () =>
    root.render(
      <MediaPreview path={path} kind="image" workspaceEnv={LOCAL_WORKSPACE} />,
    ),
  );
  await blobReady();
  expect(io.binary).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 7 }),
    "/srv/project/image.png",
  );
  expect(io.release).toHaveBeenCalledOnce();
  expect(io.convert).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});
it("loads a relative Markdown image from its document's saved SSH project", async () => {
  await act(async () =>
    root.render(
      <MarkdownDocContext.Provider
        value={{
          docPath: "remote://voktty-ssh-fixture/srv/project/docs/readme.md",
          workspaceEnv: LOCAL_WORKSPACE,
        }}
      >
        <MarkdownImage src="../image.png" alt="Remote" />
      </MarkdownDocContext.Provider>,
    ),
  );
  await blobReady();
  expect(io.binary).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 7 }),
    "/srv/project/image.png",
  );
  expect(io.convert).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});
it("revokes a namespace media blob only after its presentation retires", async () => {
  await act(async () =>
    root.render(
      <MediaPreview path={path} kind="image" workspaceEnv={LOCAL_WORKSPACE} />,
    ),
  );
  await blobReady();
  expect(io.revoke).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(io.revoke).toHaveBeenCalledExactlyOnceWith("blob:fixture");
});

it("ignores a retired binary result without allocating or revoking a successor blob", async () => {
  let finish!: (value: {
    bytes: Uint8Array;
    size: number;
    mtime: number;
  }) => void;
  io.binary.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(<Source />));
  await vi.waitFor(() => expect(io.binary).toHaveBeenCalledOnce());
  expect(io.release).not.toHaveBeenCalled();
  await act(async () => root.render(<Source target="/work/local.png" />));
  expect(media.src).toBe("asset:///work/local.png");
  await act(async () =>
    finish({ bytes: new Uint8Array([1]), size: 1, mtime: 1 }),
  );
  expect(io.create).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
  expect(media.src).toBe("asset:///work/local.png");
});

it("keeps a pending acquisition charged until its retired request releases its own lease", async () => {
  let finish!: (value: {
    info: { session_id: number; workspace_root: string };
    release: () => void;
  }) => void;
  io.acquire.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(<Source />));
  await vi.waitFor(() => expect(io.acquire).toHaveBeenCalledOnce());
  await act(async () => root.render(null));
  await act(async () =>
    finish({
      info: { session_id: 7, workspace_root: "/srv/project" },
      release: io.release,
    }),
  );
  expect(io.binary).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
  expect(io.create).not.toHaveBeenCalled();
});

it("coalesces local asset fallback and retains its explicit document filesystem", async () => {
  await act(async () => root.render(<Source target="/work/local.png" />));
  const captured = media;
  let finish!: (bytes: number[]) => void;
  io.invoke.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    captured.onError();
    captured.onError();
  });
  expect(io.invoke).toHaveBeenCalledExactlyOnceWith("fs_read_binary_file", {
    path: "/work/local.png",
    workspace: LOCAL_WORKSPACE,
  });
  await act(async () => finish([1, 2, 3]));
  await blobReady();
  expect(io.create.mock.calls[0][0].type).toBe("image/png");
  await act(async () => captured.onError());
  expect(media.failed).toBe(false);
});

it("uses explicit WSL for binary reads even while a different global workspace is selected", async () => {
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ambient" } });
  io.invoke.mockResolvedValue([1, 2, 3]);
  await readySource("/work/image.png", { kind: "wsl", distro: "Owned" });
  expect(io.invoke).toHaveBeenCalledWith("fs_read_binary_file", {
    path: "/work/image.png",
    workspace: { kind: "wsl", distro: "Owned" },
  });
  expect(io.convert).not.toHaveBeenCalled();
});

it("preserves native Windows paths from a WSL document context", async () => {
  await act(async () =>
    root.render(
      <Source
        target="C:/work/image.png"
        workspace={{ kind: "wsl", distro: "Owned" }}
      />,
    ),
  );
  expect(media.src).toBe("asset://C:/work/image.png");
  expect(io.binary).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("uses an explicitly captured SSH helper for host paths", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/work",
    sessionId: 19,
    connection: { id: "other", name: "Other", host: "host-b" },
  };
  await readySource("/work/image.png", workspace);
  expect(io.binary).toHaveBeenCalledWith(workspace, "/work/image.png");
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.convert).not.toHaveBeenCalled();
});

it("fails closed and permits an explicit retry after read failure", async () => {
  io.binary.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(<Source />));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(media.failed).toBe(true);
  });
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.convert).not.toHaveBeenCalled();
  await act(async () => media.retry());
  await blobReady();
  expect(io.binary).toHaveBeenCalledTimes(2);
});

it("does not acquire or fall back to native IO when a saved profile is missing", async () => {
  usePreferencesStore.setState({ sshConnections: [] });
  await act(async () => root.render(<Source />));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(media.failed).toBe(true);
  });
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.convert).not.toHaveBeenCalled();
});

it("does not admit the discarded StrictMode acquisition", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Source />
      </StrictMode>,
    ),
  );
  await blobReady();
  expect(io.binary).toHaveBeenCalledOnce();
  expect(io.acquire).toHaveBeenCalledOnce();
});

it("revokes only a replaced blob and ignores callbacks from a previous publication", async () => {
  await readySource();
  const old = media;
  await act(async () => media.onError());
  expect(media.failed).toBe(true);
  io.create.mockReturnValue("blob:successor");
  await act(async () => media.retry());
  await vi.waitFor(() => expect(media.src).toBe("blob:successor"));
  expect(io.revoke).toHaveBeenCalledExactlyOnceWith("blob:fixture");
  await act(async () => old.onError());
  expect(media.failed).toBe(false);
  await act(async () => root.render(null));
  expect(io.revoke).toHaveBeenLastCalledWith("blob:successor");
});

it("passes external Markdown images through without filesystem work", async () => {
  await act(async () =>
    root.render(
      <MarkdownDocContext.Provider
        value={{ docPath: path, workspaceEnv: LOCAL_WORKSPACE }}
      >
        <MarkdownImage src="https://images.example/logo.png" alt="External" />
      </MarkdownDocContext.Provider>,
    ),
  );
  expect(node.querySelector("img")?.getAttribute("src")).toBe(
    "https://images.example/logo.png",
  );
  expect(io.binary).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.convert).not.toHaveBeenCalled();
});

it("retains the shared read budget for retired binary work until settlement", async () => {
  const finish: Array<
    (value: { bytes: Uint8Array; size: number; mtime: number }) => void
  > = [];
  io.binary.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      }),
  );
  await act(async () =>
    root.render(
      Array.from(
        { length: 256 },
        (_, index) =>
          `remote://voktty-ssh-fixture/srv/project/image-${index}.png`,
      ).map((target) => <Source key={target} target={target} />),
    ),
  );
  await vi.waitFor(() => expect(io.binary).toHaveBeenCalledTimes(256));
  await act(async () => root.render(<Source />));
  expect(media.failed).toBe(true);
  expect(io.acquire).toHaveBeenCalledTimes(256);
  io.binary.mockResolvedValue({
    bytes: new Uint8Array([1]),
    size: 1,
    mtime: 1,
  });
  await act(async () =>
    finish.forEach((resolve) => {
      resolve({ bytes: new Uint8Array([1]), size: 1, mtime: 1 });
    }),
  );
  expect(io.release).toHaveBeenCalledTimes(256);
  expect(io.create).not.toHaveBeenCalled();
  await act(async () => media.retry());
  await blobReady();
  expect(io.acquire).toHaveBeenCalledTimes(257);
});

it("rejects unsupported container media without local fallback", async () => {
  await act(async () =>
    root.render(
      <Source
        target="/work/image.png"
        workspace={{
          kind: "docker",
          connection: {
            containerId: "fixture",
            containerName: "Fixture",
            image: "fixture",
          },
        }}
      />,
    ),
  );
  expect(media.failed).toBe(true);
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.convert).not.toHaveBeenCalled();
});
