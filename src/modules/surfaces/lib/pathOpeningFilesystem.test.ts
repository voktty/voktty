import { beforeEach, expect, it, vi } from "vitest";
import { pathOpeningKind } from "@/modules/surfaces/lib/pathOpeningFilesystem";
import { pathOpeningRequest } from "@/modules/surfaces/lib/pathOpeningRequest";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  stat: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote/filesystem", () => ({ remoteStat: mocks.stat }));
vi.mock("@/modules/harness/lib/fs", () => ({ listDir: mocks.list }));
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.stat.mockReset();
  mocks.list.mockReset();
});
it("opens a native file symlink without treating it as a failed lookup", async () => {
  mocks.invoke.mockResolvedValue({ kind: "symlink" });
  expect(
    await pathOpeningKind(
      pathOpeningRequest("/project/link.ts", LOCAL_WORKSPACE),
      () => true,
    ),
  ).toBe("file");
});
it.each<WorkspaceEnv>([LOCAL_WORKSPACE, { kind: "wsl", distro: "Ubuntu" }])(
  "stats native and WSL paths with the requested filesystem",
  async (workspace) => {
    mocks.invoke.mockResolvedValue({ kind: "dir" });
    expect(
      await pathOpeningKind(
        pathOpeningRequest("/project", workspace),
        () => true,
      ),
    ).toBe("dir");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("fs_stat", {
      path: "/project",
      workspace,
    });
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it("uses authenticated SSH stat and never native stat", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/project",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  mocks.stat.mockResolvedValue({ kind: "file" });
  expect(
    await pathOpeningKind(
      pathOpeningRequest("/project/file.ts", workspace),
      () => true,
    ),
  ).toBe("file");
  expect(mocks.stat).toHaveBeenCalledExactlyOnceWith(
    workspace,
    "/project/file.ts",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("resolves a namespace root by listing that directory instead of looking for its host name", async () => {
  mocks.list.mockImplementation(async (path) => {
    if (path !== "remote://host/") throw new Error("outside root");
    return [];
  });
  expect(
    await pathOpeningKind(
      pathOpeningRequest("remote://host/", LOCAL_WORKSPACE),
      () => true,
    ),
  ).toBe("dir");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("classifies a saved remote project root without requiring access to its parent", async () => {
  mocks.list.mockImplementation(async (path) => {
    if (path !== "remote://host/project") throw new Error("outside project");
    return [];
  });
  expect(
    await pathOpeningKind(
      pathOpeningRequest("remote://host/project", LOCAL_WORKSPACE),
      () => true,
    ),
  ).toBe("dir");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("classifies a remote file through its own namespace after directory lookup fails", async () => {
  mocks.list.mockImplementation(async (path) => {
    if (path === "remote://host/project/file.ts")
      throw new Error("not directory");
    return [{ name: "file.ts", isDir: false }];
  });
  expect(
    await pathOpeningKind(
      pathOpeningRequest("remote://host/project/file.ts", LOCAL_WORKSPACE),
      () => true,
    ),
  ).toBe("file");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("preserves the UNC namespace while locating a remote file's parent", async () => {
  mocks.list.mockImplementation(async (path) => {
    if (path === "remote://host//server/share/docs/")
      return [{ name: "file.ts", isDir: false }];
    throw new Error("Not the owning directory");
  });
  expect(
    await pathOpeningKind(
      pathOpeningRequest(
        "remote://host//server/share/docs/file.ts",
        LOCAL_WORKSPACE,
      ),
      () => true,
    ),
  ).toBe("file");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("does not enter a lazy remote reader after retirement", async () => {
  await expect(
    pathOpeningKind(
      pathOpeningRequest("remote://host/project", LOCAL_WORKSPACE),
      () => false,
    ),
  ).rejects.toThrow();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("rejects missing or unsupported stat results", async () => {
  mocks.invoke.mockResolvedValue({ kind: "other" });
  await expect(
    pathOpeningKind(
      pathOpeningRequest("/missing", LOCAL_WORKSPACE),
      () => true,
    ),
  ).rejects.toThrow();
});
