// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectDocument } from "@/modules/remote/projectDocument";
import { searchFilenames } from "@/modules/explorer/lib/filenameSearch";
import {
  rememberRemoteProject,
  remoteProjectForPath,
} from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { RemoteRequestError } from "@/modules/remote/client";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";

const io = vi.hoisted(() => ({
  request: vi.fn(),
  acquire: vi.fn(),
  handle: vi.fn(),
  sftpRead: vi.fn(),
  sftpStat: vi.fn(),
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/ssh-native/handles", () => ({ nativeHandleFor: io.handle }));
vi.mock("@/modules/ssh-native/client", async (original) => ({
  ...(await original<typeof import("@/modules/ssh-native/client")>()),
  sftpReadText: io.sftpRead,
  sftpStat: io.sftpStat,
}));

const profile = { id: "fixture", name: "Fixture", host: "fixture.invalid" };
const root = "remote://voktty-ssh-fixture/alias/project";
let project: ReturnType<typeof rememberRemoteProject>;
let canonical = "/actual/project";
let content = "original";
let leases: RemoteSessionLease[];

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  project = rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Fixture",
    cwd: "/alias/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  canonical = "/actual/project";
  content = "original";
  leases = [];
  io.handle.mockResolvedValue(undefined);
  io.acquire.mockImplementation(async () => {
    const lease: RemoteSessionLease = {
      info: {
        session_id: 7,
        workspace_root: canonical,
        architecture: "x86_64",
        helper_version: "1",
        capabilities: ["fs.searchNames"],
      },
      release: vi.fn(),
    };
    leases.push(lease);
    return lease;
  });
  io.request.mockImplementation(
    async (id: number, method: string, params: Record<string, unknown>) => {
      expect(id).toBe(7);
      if (method === "fs.searchNames")
        return {
          hits: [{ rel: "file.txt", name: "file.txt", is_dir: false }],
          truncated: false,
        };
      const path = params.path;
      if (
        typeof path !== "string" ||
        path.startsWith("/") ||
        path.split("/").some((part) => part === "..")
      )
        throw new RemoteRequestError(
          "invalid_path",
          "path is outside the workspace root",
        );
      if (method === "fs.readFile")
        return { content, size: content.length, mtime: 10 };
      if (method === "fs.stat")
        return {
          kind: path === "." ? "dir" : "file",
          size: content.length,
          mtime: 11,
        };
      if (method === "fs.readBinaryFile")
        return { contentBase64: "AP+A", size: 3, mtime: 10 };
      if (method === "fs.writeFile") {
        if (params.expectedContent !== content)
          throw new RemoteRequestError(
            "write_failed",
            "File changed on disk; save cancelled.",
          );
        content = params.content as string;
        return {};
      }
      throw new Error("Unexpected helper request");
    },
  );
});
afterEach(() => {
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("opens a namespaced search result under the helper's canonical root", async () => {
  const result = await searchFilenames(
    { kind: "local" },
    root,
    "file",
    false,
    () => true,
  );
  const path = result.hits[0].path;
  expect(path).toBe(`${root}/file.txt`);
  const document = createProjectDocument(path, remoteProjectForPath(path), [
    profile,
  ]);
  await expect(document.read(false, () => true)).resolves.toMatchObject({
    kind: "text",
    content: "original",
  });
  expect(io.request).toHaveBeenLastCalledWith(7, "fs.readFile", {
    path: "file.txt",
  });
  expect(project.cwd).toBe("/alias/project");
  expect(
    leases.every((lease) => vi.mocked(lease.release).mock.calls.length === 1),
  ).toBe(true);
});

it.each(["text", "media", "binary", "stat", "write"])(
  "uses the accepted root for %s IO",
  async (operation) => {
    const document = createProjectDocument(`${root}/file.txt`, project, [
      profile,
    ]);
    if (operation === "text")
      await expect(document.read(false, () => true)).resolves.toMatchObject({
        content: "original",
      });
    if (operation === "media")
      await expect(document.read(true, () => true)).resolves.toMatchObject({
        kind: "binary",
        size: 8,
      });
    if (operation === "binary")
      expect([...(await document.readBinary(() => true)).bytes]).toEqual([
        0, 255, 128,
      ]);
    if (operation === "stat")
      await expect(document.stat(() => true)).resolves.toMatchObject({
        mtime: 11,
      });
    if (operation === "write") {
      await expect(
        document.write("edited", () => true, "original"),
      ).resolves.toBe(11);
      expect(content).toBe("edited");
      expect(io.request).toHaveBeenCalledWith(7, "fs.writeFile", {
        path: "file.txt",
        content: "edited",
        expectedContent: "original",
      });
    }
    expect(
      io.request.mock.calls.every(([, , params]) => params.path === "file.txt"),
    ).toBe(true);
    expect(leases[0].release).toHaveBeenCalledOnce();
  },
);

it("keeps a conditional write conflict unchanged under an alias", async () => {
  const document = createProjectDocument(`${root}/file.txt`, project, [
    profile,
  ]);
  await expect(document.write("edited", () => true, "stale")).rejects.toThrow(
    "File changed on disk",
  );
  expect(content).toBe("original");
  expect(io.request).toHaveBeenCalledTimes(1);
  expect(leases[0].release).toHaveBeenCalledOnce();
});

it("uses the project root itself for root metadata", async () => {
  await expect(
    createProjectDocument(root, project, [profile]).stat(() => true),
  ).resolves.toMatchObject({ kind: "dir" });
  expect(io.request).toHaveBeenCalledExactlyOnceWith(7, "fs.stat", {
    path: ".",
  });
});

it("uses the captured canonical path for a ready SFTP backend", async () => {
  io.handle.mockResolvedValue("owned-handle");
  io.sftpRead.mockResolvedValue("original");
  io.sftpStat.mockResolvedValue({ isDir: false, size: 8, modifiedMs: 10 });
  await expect(
    createProjectDocument(`${root}/file.txt`, project, [profile]).read(
      false,
      () => true,
    ),
  ).resolves.toMatchObject({ content: "original" });
  expect(io.sftpRead).toHaveBeenCalledExactlyOnceWith(
    "owned-handle",
    "/actual/project/file.txt",
  );
  expect(io.request).not.toHaveBeenCalled();
});
