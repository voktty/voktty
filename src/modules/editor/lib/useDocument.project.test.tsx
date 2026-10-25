// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocument } from "@/modules/editor/lib/useDocument";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  read: vi.fn(),
  stat: vi.fn(),
  write: vi.fn(),
  invoke: vi.fn(),
  warning: vi.fn(),
  saved: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/lsp", () => ({ notifyDocumentSaved: io.saved }));
vi.mock("sonner", () => ({ toast: { warning: io.warning } }));
vi.mock("@/modules/connections/model/remoteProjects", async (original) => ({
  ...(await original<
    typeof import("@/modules/connections/model/remoteProjects")
  >()),
  remoteProjectForPath: () => ({
    key: "project",
    projectId: "project",
    environmentId: "voktty-ssh-fixture",
    cwd: "/srv/project",
  }),
}));
vi.mock("@/modules/remote", () => ({
  isPathInRemoteWorkspace: () => false,
  remoteReadDocument: vi.fn(),
  remoteStat: vi.fn(),
  remoteWriteFile: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: {
    acquire: async () => ({
      info: { session_id: 7, workspace_root: "/srv/project" },
      release: vi.fn(),
    }),
  },
}));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteReadDocument: (_: unknown, target: string, binary: boolean) =>
    io.read(target, binary),
  remoteStat: (_: unknown, target: string) => io.stat(target),
  remoteRelativePath: (_: unknown, target: string) =>
    target.slice("/srv/project/".length),
}));
vi.mock("@/modules/remote/client", () => ({ requestRemoteResult: io.write }));

const path = "remote://voktty-ssh-fixture/srv/project/file.txt";
const local = { kind: "local" } as const;
let root: Root;
let node: HTMLDivElement;
let document: ReturnType<typeof useDocument>;
function Reader({ target = path }: { target?: string }) {
  document = useDocument({ path: target, workspaceEnv: local });
  return null;
}
async function ready(target = path) {
  await act(async () => root.render(<Reader target={target} />));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.doc.status).toBe("ready");
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  io.read.mockImplementation(async (target: string) => ({
    kind: "text",
    content: target.endsWith("other.txt") ? "other" : "original\r\n",
    size: 10,
    mtime: 1,
  }));
  io.stat.mockResolvedValue({ kind: "file", size: 10, mtime: 1 });
  io.write.mockResolvedValue(2);
  io.invoke.mockResolvedValue({
    kind: "text",
    content: "native",
    size: 6,
    mtime: 1,
  });
  usePreferencesStore.setState({
    editorAutoSave: false,
    sshConnections: [{ id: "fixture", name: "Fixture", host: "host-a" }],
  });
  node = window.document.createElement("div");
  window.document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("reads and conditionally saves a namespace without local filesystem calls", async () => {
  await ready();
  expect(document.doc).toMatchObject({ content: "original\n" });
  await act(async () => document.onChange("edited\n"));
  await act(async () => expect(await document.save()).toBe(true));
  expect(io.write).toHaveBeenCalledWith(7, "fs.writeFile", {
    path: "file.txt",
    content: "edited\r\n",
    expectedContent: "original\r\n",
  });
  expect(document.dirty).toBe(false);
  expect(io.invoke).not.toHaveBeenCalled();
});

it("keeps ordinary native document routing", async () => {
  await ready("/work/file.txt");
  expect(io.invoke).toHaveBeenCalledWith(
    "fs_read_file",
    expect.objectContaining({ path: "/work/file.txt" }),
  );
  expect(io.read).not.toHaveBeenCalled();
});

it("retains the conflict prompt and only omits conditional content on explicit overwrite", async () => {
  await ready();
  await act(async () => document.onChange("edited"));
  io.stat.mockResolvedValue({ kind: "file", size: 11, mtime: 2 });
  await act(async () => expect(await document.save()).toBe(false));
  expect(io.write).not.toHaveBeenCalled();
  const options = io.warning.mock.calls[0][1];
  await act(async () => options.action.onClick());
  expect(io.write).toHaveBeenCalledWith(7, "fs.writeFile", {
    path: "file.txt",
    content: "edited",
  });
});

it("does not write after the document retires during its preflight", async () => {
  await ready();
  await act(async () => document.onChange("edited"));
  let resolve!: (stat: { kind: string; mtime: number; size: number }) => void;
  io.stat.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = document.save();
  });
  await vi.waitFor(() => expect(io.stat).toHaveBeenCalledOnce());
  await ready("remote://voktty-ssh-fixture/srv/project/other.txt");
  await act(async () => {
    resolve({ kind: "file", mtime: 1, size: 10 });
    expect(await saving).toBe(false);
  });
  expect(io.write).not.toHaveBeenCalled();
  expect(document.doc).toMatchObject({ content: "other" });
});

it("fails closed when a namespace stat fails before saving", async () => {
  await ready();
  await act(async () => document.onChange("edited"));
  io.stat.mockRejectedValue(new Error("connection lost"));
  await act(async () => {
    await expect(document.save()).rejects.toThrow("connection lost");
  });
  expect(io.write).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(document.dirty).toBe(true);
});

it("retires cached conflict actions on unmount", async () => {
  await ready();
  await act(async () => document.onChange("edited"));
  io.stat.mockResolvedValue({ kind: "file", size: 11, mtime: 2 });
  await act(async () => document.save());
  const options = io.warning.mock.calls[0][1];
  await act(async () => root.render(null));
  await act(async () => options.action.onClick());
  expect(io.write).not.toHaveBeenCalled();
});

it("survives StrictMode retirement without admitting the discarded reader", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Reader />
      </StrictMode>,
    ),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.doc).toEqual({
      status: "ready",
      content: "original\n",
      size: 10,
    });
  });
  expect(io.read).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("keeps edits typed while a namespace write is settling dirty", async () => {
  await ready();
  await act(async () => document.onChange("first"));
  let resolve!: (mtime: number) => void;
  io.write.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = document.save();
  });
  await vi.waitFor(() => expect(io.write).toHaveBeenCalledOnce());
  await act(async () => document.onChange("second"));
  await act(async () => {
    resolve(2);
    await saving;
  });
  expect(document.dirty).toBe(true);
});
