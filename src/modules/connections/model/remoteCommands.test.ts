import { beforeEach, expect, it, vi } from "vitest";

const {
  remoteRequest,
  remoteMachineFor,
  invokeLocal,
  openRemoteWorkspace,
  closeRemoteWorkspace,
  requestRemoteResult,
  preferences,
} = vi.hoisted(() => ({
  remoteRequest: vi.fn(),
  invokeLocal: vi.fn(),
  openRemoteWorkspace: vi.fn(),
  closeRemoteWorkspace: vi.fn(),
  requestRemoteResult: vi.fn(),
  preferences: { sshConnections: [] as Record<string, unknown>[] },
  remoteMachineFor: vi.fn(async (environmentId: string) =>
    environmentId === "env"
      ? { id: "machine", name: "Home", endpoint: "", environmentId }
      : undefined,
  ),
}));
vi.mock("./connections", () => ({ remoteRequest, remoteMachineFor }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeLocal }));
vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace,
  closeRemoteWorkspace,
  requestRemoteResult,
  RemoteRequestError: class RemoteRequestError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => preferences },
}));

import {
  gitDiffIndex,
  gitDiffStats,
  gitDiscardFile,
  gitFileDiff,
  gitStageAll,
  gitStageContents,
  gitStageFile,
  gitUnstageAll,
  gitUnstageFile,
  listDir,
  readBinaryFile,
  readTextFile,
  statFiles,
  writeTextFile,
} from "@/modules/harness/lib/fs";
import { searchProject } from "@/modules/harness/lib/search";
import { runRemoteCommand } from "./remoteCommands";
import { parseRemotePath, remotePath } from "./remoteProjects";
import { remoteSshEnvironmentId } from "./remoteSshProfiles";

const storage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      get length() {
        return storage.size;
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  remoteRequest.mockReset();
  invokeLocal.mockReset();
  openRemoteWorkspace.mockReset().mockResolvedValue({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.16",
    capabilities: ["git.execWorkspaceInput"],
  });
  closeRemoteWorkspace.mockReset().mockResolvedValue(undefined);
  requestRemoteResult.mockReset();
  preferences.sshConnections = [];
  localStorage.clear();
});

it("keeps local writes local when their content mentions a remote path", async () => {
  await writeTextFile("/home/me/note.txt", "remote://env/home/me/repo");
  expect(invokeLocal).toHaveBeenCalledWith("write_text_file", {
    path: "/home/me/note.txt",
    content: "remote://env/home/me/repo",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("runs the same file command on the machine with host paths", async () => {
  remoteRequest.mockResolvedValue([
    { name: "src", path: "/home/me/repo/src", isDir: true, ignored: false },
  ]);
  expect(await listDir("remote://env/home/me/repo")).toEqual([
    {
      name: "src",
      path: "remote://env/home/me/repo/src",
      isDir: true,
      ignored: false,
    },
  ]);
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "list_dir",
    args: { path: "/home/me/repo" },
  });
});

it("maps path results back and leaves file contents alone", async () => {
  remoteRequest.mockResolvedValueOnce("remote://not-a-path");
  expect(await readTextFile("remote://env/home/me/a.txt")).toBe(
    "remote://not-a-path",
  );
  remoteRequest.mockResolvedValueOnce([{ path: "/home/me/a.txt", mtimeMs: 1 }]);
  expect(await statFiles(["remote://env/home/me/a.txt"])).toEqual([
    { path: "remote://env/home/me/a.txt", mtimeMs: 1 },
  ]);
  remoteRequest.mockResolvedValueOnce("/home/me/b.txt");
  expect(
    await runRemoteCommand("rename_path", {
      path: "remote://env/home/me/a.txt",
      name: "b.txt",
    }),
  ).toBe("remote://env/home/me/b.txt");
  remoteRequest.mockResolvedValueOnce("C:/work/x.ts");
  expect(
    await runRemoteCommand("create_path", {
      parent: "remote://env/C:/work",
      name: "x.ts",
      isDir: false,
    }),
  ).toBe("remote://env/C:/work/x.ts");
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "create_path",
    args: { parent: "C:/work", name: "x.ts", isDir: false },
  });
});

it("decodes remote binary reads", async () => {
  remoteRequest.mockResolvedValueOnce("AAEC/w==");
  expect(await readBinaryFile("remote://env/home/me/image.png")).toEqual(
    new Uint8Array([0, 1, 2, 255]),
  );
});

it("preserves Windows drive and UNC paths", () => {
  expect(parseRemotePath(remotePath("env", "C:\\work\\repo"))?.hostPath).toBe(
    "C:/work/repo",
  );
  expect(
    parseRemotePath(remotePath("env", "\\\\server\\share\\repo"))?.hostPath,
  ).toBe("//server/share/repo");
});

it("adds remote paths to Git index entries", async () => {
  remoteRequest.mockResolvedValueOnce({
    branch: "main",
    files: [{ path: "src/app.ts", relative: "src/app.ts", status: "modified" }],
  });
  const index = (await runRemoteCommand("git_diff_index", {
    cwd: "remote://env/home/me/repo",
  })) as { files: { path: string }[] };
  expect(index.files[0].path).toBe("remote://env/home/me/repo/src/app.ts");
});

function gitExecResult(
  stdout: string,
  exitCode: number | null = 0,
  stderr = "",
) {
  return {
    stdout: btoa(stdout),
    stderr,
    exitCode,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function mockNativeGitIndex(status: string, numstat = "") {
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      const command = args[0] === "--literal-pathspecs" ? args[1] : args[0];
      switch (command) {
        case "status":
          return gitExecResult(status);
        case "diff":
          return gitExecResult(numstat);
        case "remote":
          return gitExecResult("origin\n");
        case "symbolic-ref":
          return gitExecResult("origin/main\n");
        case "rev-list":
          return gitExecResult("3\n");
        case "add":
        case "restore":
        case "clean":
          return gitExecResult("");
        default:
          throw new Error(`Unexpected Git command: ${command}`);
      }
    },
  );
}

it("loads remote Git status and statistics through the native helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  mockNativeGitIndex(
    [
      "# branch.oid abc123",
      "# branch.head feature/demo",
      "# branch.upstream origin/feature/demo",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 abc def main.ts",
      "? new file.ts",
      "",
    ].join("\0"),
    "3\t1\tmain.ts\0",
  );

  await expect(
    gitDiffIndex(remotePath(environmentId, "/srv/app/src")),
  ).resolves.toMatchObject({
    branch: "feature/demo",
    upstream: "origin/feature/demo",
    ahead: 2,
    behind: 1,
    remote: "origin",
    defaultBranch: "main",
    aheadOfDefault: 3,
    files: [
      {
        path: remotePath(environmentId, "/srv/app/src/main.ts"),
        relative: "main.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        staged: false,
        unstaged: true,
      },
      {
        path: remotePath(environmentId, "/srv/app/src/new file.ts"),
        relative: "new file.ts",
        status: "untracked",
      },
    ],
    additions: 3,
    deletions: 1,
  });
  await expect(
    gitDiffStats(remotePath(environmentId, "/srv/app/src")),
  ).resolves.toEqual({
    files: 2,
    additions: 3,
    deletions: 1,
  });
  expect(requestRemoteResult).toHaveBeenCalledWith(
    9,
    "git.execWorkspace",
    expect.objectContaining({
      cwd: "src",
      args: [
        "status",
        "--porcelain=v2",
        "--branch",
        "--ahead-behind",
        "--untracked-files=all",
        "-z",
      ],
    }),
  );
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("stages and unstages remote paths with literal Git pathspecs", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValue(gitExecResult(""));

  await gitStageFile(remotePath(environmentId, "/srv/app"), "src/a[1].ts");
  await gitUnstageFile(remotePath(environmentId, "/srv/app"), "src/a[1].ts");
  await gitStageAll(remotePath(environmentId, "/srv/app"));
  await gitUnstageAll(remotePath(environmentId, "/srv/app"));

  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toEqual([
    ["--literal-pathspecs", "add", "--", "src/a[1].ts"],
    ["--literal-pathspecs", "restore", "--staged", "--", "src/a[1].ts"],
    ["--literal-pathspecs", "add", "-A", "--", "."],
    ["--literal-pathspecs", "restore", "--staged", "--", "."],
  ]);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledTimes(4);
});

it("stages unsaved SSH editor contents through bounded helper stdin", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method === "git.execWorkspaceInput") {
        return gitExecResult(`${"a".repeat(40)}\n`);
      }
      if (method === "git.execWorkspace") {
        const args = params.args as string[];
        if (args[1] === "ls-files") {
          return gitExecResult("100755 abc 0\tsrc/main.ts\n");
        }
        if (args[0] === "update-index") return gitExecResult("");
      }
      throw new Error(`Unexpected helper request: ${method}`);
    },
  );

  await gitStageContents(
    remotePath(environmentId, "/srv/app"),
    "src/main.ts",
    "editor buffer 😀\n",
  );

  expect(requestRemoteResult.mock.calls).toEqual([
    [
      9,
      "git.execWorkspaceInput",
      {
        cwd: ".",
        args: ["hash-object", "-w", "--path", "src/main.ts", "--stdin"],
        timeoutSecs: 10,
        maxOutputBytes: 64 * 1024,
        stdin: "editor buffer 😀\n",
      },
    ],
    [
      9,
      "git.execWorkspace",
      {
        cwd: ".",
        args: [
          "--literal-pathspecs",
          "ls-files",
          "--stage",
          "--",
          "src/main.ts",
        ],
        timeoutSecs: 10,
        maxOutputBytes: 64 * 1024,
      },
    ],
    [
      9,
      "git.execWorkspace",
      {
        cwd: ".",
        args: [
          "update-index",
          "--add",
          "--cacheinfo",
          "100755",
          "a".repeat(40),
          "src/main.ts",
        ],
        timeoutSecs: 10,
        maxOutputBytes: 4 * 1024 * 1024,
      },
    ],
  ]);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("rejects unsaved staging when the SSH helper has no bounded-input capability", async () => {
  const { environmentId } = registerNativeProfileProject();
  openRemoteWorkspace.mockResolvedValueOnce({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.15",
    capabilities: [],
  });

  await expect(
    gitStageContents(
      remotePath(environmentId, "/srv/app"),
      "src/main.ts",
      "editor buffer\n",
    ),
  ).rejects.toThrow("Update the Voktty remote helper");
  expect(requestRemoteResult).not.toHaveBeenCalled();
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("caps SSH editor contents before sending them to the helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  const tooLarge = "é".repeat(4 * 1024 * 1024 + 1);

  await expect(
    gitStageContents(
      remotePath(environmentId, "/srv/app"),
      "src/main.ts",
      tooLarge,
    ),
  ).rejects.toThrow("File too large");
  expect(requestRemoteResult).not.toHaveBeenCalled();
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("discards only unstaged remote changes and preserves staged content", async () => {
  const { environmentId } = registerNativeProfileProject();
  mockNativeGitIndex(
    [
      "1 .M N... 100644 100644 100644 abc def tracked.txt",
      "1 M. N... 100644 100644 100644 abc def staged.txt",
      "? nested/new file.txt",
      "",
    ].join("\0"),
  );

  await gitDiscardFile(remotePath(environmentId, "/srv/app"), "tracked.txt");
  await runRemoteCommand("git_discard_all", {
    cwd: remotePath(environmentId, "/srv/app"),
  });

  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toEqual([
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "--ahead-behind",
      "--untracked-files=all",
      "-z",
    ],
    ["--literal-pathspecs", "restore", "--worktree", "--", "tracked.txt"],
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "--ahead-behind",
      "--untracked-files=all",
      "-z",
    ],
    ["--literal-pathspecs", "restore", "--worktree", "--", "."],
    ["--literal-pathspecs", "clean", "-fd", "--", "."],
  ]);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledTimes(2);
});

it("rejects remote Git paths that escape the saved project", async () => {
  const { environmentId } = registerNativeProfileProject();

  await expect(
    gitStageFile(remotePath(environmentId, "/srv/app"), "../outside.txt"),
  ).rejects.toThrow("outside the project");
  expect(requestRemoteResult).not.toHaveBeenCalled();
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("discards an untracked remote file without a shell path", async () => {
  const { environmentId } = registerNativeProfileProject();
  mockNativeGitIndex("? nested/new file.txt\0");

  await gitDiscardFile(
    remotePath(environmentId, "/srv/app"),
    "nested/new file.txt",
  );

  expect(requestRemoteResult).toHaveBeenLastCalledWith(
    9,
    "git.execWorkspace",
    expect.objectContaining({
      cwd: ".",
      args: ["--literal-pathspecs", "clean", "-f", "--", "nested/new file.txt"],
    }),
  );
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("loads an unstaged remote Git diff with bounded helper reads", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method === "git.execWorkspace") {
        const args = params.args as string[];
        switch (args[0]) {
          case "status":
            return gitExecResult("? new.txt\0");
          case "diff":
            return gitExecResult("", 1, "fatal: no HEAD");
          case "remote":
            return gitExecResult("");
          case "symbolic-ref":
            return gitExecResult("", 1);
          case "show":
            return gitExecResult("", 128, "fatal: path not in the index");
          default:
            throw new Error(`Unexpected Git command: ${args[0]}`);
        }
      }
      if (method === "fs.stat") return { size: 12, kind: "file", mtime: 1 };
      if (method === "fs.readFile") return { content: "new file\n" };
      throw new Error(`Unexpected helper method: ${method}`);
    },
  );

  await expect(
    gitFileDiff(remotePath(environmentId, "/srv/app"), "new.txt"),
  ).resolves.toEqual({
    path: remotePath(environmentId, "/srv/app/new.txt"),
    relative: "new.txt",
    status: "untracked",
    original: "",
    current: "new file\n",
    binary: false,
    tooLarge: false,
  });
  expect(requestRemoteResult).toHaveBeenCalledWith(9, "fs.readFile", {
    path: "new.txt",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("rejects truncated remote Git status instead of parsing partial paths", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce({
    ...gitExecResult("? partial.txt\0"),
    stdoutTruncated: true,
  });

  await expect(
    gitDiffIndex(remotePath(environmentId, "/srv/app")),
  ).rejects.toThrow("Remote Git output exceeded its size limit");
  expect(requestRemoteResult).toHaveBeenCalledTimes(1);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("marks remote file diffs too large when the helper caps a Git blob", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method === "git.execWorkspace") {
        const args = params.args as string[];
        switch (args[0]) {
          case "status":
            return gitExecResult(
              "1 .M N... 100644 100644 100644 abc def large.txt\0",
            );
          case "diff":
            return gitExecResult("1\t0\tlarge.txt\0");
          case "remote":
            return gitExecResult("");
          case "symbolic-ref":
            return gitExecResult("", 1);
          case "show":
            return { ...gitExecResult("partial"), stdoutTruncated: true };
          default:
            throw new Error(`Unexpected Git command: ${args[0]}`);
        }
      }
      if (method === "fs.stat") return { size: 7, kind: "file", mtime: 1 };
      if (method === "fs.readFile") return { content: "current" };
      throw new Error(`Unexpected helper method: ${method}`);
    },
  );

  await expect(
    gitFileDiff(remotePath(environmentId, "/srv/app"), "large.txt"),
  ).resolves.toMatchObject({
    original: "",
    current: "current",
    binary: false,
    tooLarge: true,
  });
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("routes project search through the host and maps match paths", async () => {
  remoteRequest.mockResolvedValueOnce({
    matches: [
      { path: "/home/me/repo/src/app.ts", relative: "src/app.ts", line: 4 },
    ],
    truncated: false,
  });
  expect(
    await runRemoteCommand("search_project", {
      options: { cwd: "remote://env/home/me/repo", query: "hello" },
    }),
  ).toMatchObject({
    matches: [{ path: "remote://env/home/me/repo/src/app.ts", line: 4 }],
  });
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "search_project",
    args: { options: { cwd: "/home/me/repo", query: "hello" } },
  });
});

it("routes the Harness search caller through the legacy Host connection", async () => {
  remoteRequest.mockResolvedValueOnce({
    matches: [
      { path: "/home/me/repo/src/app.ts", relative: "src/app.ts", line: 4 },
    ],
    truncated: false,
  });

  await expect(
    searchProject({ cwd: "remote://env/home/me/repo", query: "hello" }),
  ).resolves.toMatchObject({
    matches: [{ path: "remote://env/home/me/repo/src/app.ts", line: 4 }],
    truncated: false,
  });
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "search_project",
    args: { options: { cwd: "/home/me/repo", query: "hello" } },
  });
});

function registerNativeProfileProject() {
  const profile = {
    id: "profile-native",
    name: "Build host",
    host: "build-host",
    user: "dev",
    port: 2222,
    identityFile: "/keys/build",
  };
  const environmentId = remoteSshEnvironmentId(profile.id);
  preferences.sshConnections = [profile];
  const project = {
    key: remotePath(environmentId, "/srv/app"),
    environmentId,
    projectId: "remote-project",
    cwd: "/srv/app",
  };
  localStorage.setItem(
    "terax.remote-projects.v2",
    JSON.stringify({ [project.key]: project }),
  );
  return { environmentId, profile };
}

it("runs saved SSH profile file operations through the Voktty helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce({
    entries: [{ name: "src", kind: "directory", size: 0, mtime: 1 }],
  });

  expect(await listDir(remotePath(environmentId, "/srv/app"))).toEqual([
    {
      name: "src",
      path: remotePath(environmentId, "/srv/app/src"),
      isDir: true,
      ignored: false,
    },
  ]);
  expect(openRemoteWorkspace).toHaveBeenCalledWith(
    {
      host: "build-host",
      user: "dev",
      port: 2222,
      identityFile: "/keys/build",
    },
    "/srv/app",
  );
  expect(requestRemoteResult).toHaveBeenCalledWith(9, "fs.readDir", {
    path: ".",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("sends expected text to the native helper for conflict-safe remote writes", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce({ path: "/srv/app/a.txt" });

  await runRemoteCommand("write_text_file", {
    path: remotePath(environmentId, "/srv/app/a.txt"),
    content: "edited",
    expectedContent: "original",
  });

  expect(requestRemoteResult).toHaveBeenCalledWith(9, "fs.writeFile", {
    path: "a.txt",
    content: "edited",
    expectedContent: "original",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("lists project files through bounded helper traversal and skips ignored entries", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult
    .mockResolvedValueOnce({ content: "*.log\nprivate\n" })
    .mockResolvedValueOnce({
      entries: [
        { name: "app.log", kind: "file", size: 0, mtime: 1 },
        { name: "private", kind: "directory", size: 0, mtime: 1 },
        { name: "src", kind: "directory", size: 0, mtime: 1 },
        { name: "README.md", kind: "file", size: 0, mtime: 1 },
      ],
    })
    .mockResolvedValueOnce({
      entries: [{ name: "main.ts", kind: "file", size: 0, mtime: 1 }],
    });

  expect(
    await runRemoteCommand("list_project_files", {
      cwd: remotePath(environmentId, "/srv/app"),
    }),
  ).toEqual([
    {
      name: "README.md",
      relative: "README.md",
      path: remotePath(environmentId, "/srv/app/README.md"),
    },
    {
      name: "main.ts",
      relative: "src/main.ts",
      path: remotePath(environmentId, "/srv/app/src/main.ts"),
    },
  ]);
  expect(requestRemoteResult).not.toHaveBeenCalledWith(
    9,
    "git.exec",
    expect.anything(),
  );
});

it("searches saved SSH projects through bounded helper grep results", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce({
    hits: [
      {
        path: "/srv/app/src/app.ts",
        rel: "src/app.ts",
        line: 4,
        column: 7,
        match_length: 5,
        preview_column: 7,
        text: "export const hello = true;",
      },
    ],
    truncated: true,
    files_scanned: 23,
    cancelled: false,
  });

  await expect(
    searchProject({
      cwd: remotePath(environmentId, "/srv/app/src"),
      query: "hello",
      caseSensitive: true,
      wholeWord: true,
      regex: false,
      include: "src/**,*.tsx",
      exclude: "*.lock",
    }),
  ).resolves.toEqual({
    matches: [
      {
        path: remotePath(environmentId, "/srv/app/src/app.ts"),
        relative: "src/app.ts",
        line: 4,
        column: 7,
        preview: "export const hello = true;",
      },
    ],
    truncated: true,
  });
  expect(requestRemoteResult).toHaveBeenCalledWith(9, "fs.grep", {
    pattern: "hello",
    cwd: "src",
    include: ["src/**", "*.tsx"],
    exclude: ["*.lock"],
    caseSensitive: true,
    wholeWord: true,
    regex: false,
    showHidden: true,
    maxResults: 500,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("rejects helper search results that escape the saved project root", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce({
    hits: [
      {
        rel: "../secret.txt",
        line: 1,
        column: 1,
        text: "secret",
      },
    ],
    truncated: false,
  });

  await expect(
    searchProject({
      cwd: remotePath(environmentId, "/srv/app"),
      query: "secret",
    }),
  ).rejects.toThrow("search path outside the project");
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("rejects saved profile paths and Git results outside the project", async () => {
  const { environmentId } = registerNativeProfileProject();
  await expect(
    runRemoteCommand("list_dir", {
      path: remotePath(environmentId, "/srv/other/project"),
    }),
  ).rejects.toThrow("outside a saved remote project");
  requestRemoteResult.mockResolvedValueOnce(
    gitExecResult("? ../outside.txt\0"),
  );
  await expect(
    gitDiffIndex(remotePath(environmentId, "/srv/app")),
  ).rejects.toThrow("Git returned a path outside the saved project");
  expect(openRemoteWorkspace).toHaveBeenCalledTimes(1);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("refuses what the host cannot do and explains outdated hosts", async () => {
  await expect(
    runRemoteCommand("reveal_path", { path: "remote://env/home/me/a" }),
  ).rejects.toThrow("isn’t available for projects on another machine");
  await expect(
    runRemoteCommand("copy_path", {
      from: "/Users/me/local.txt",
      destParent: "remote://env/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(
    runRemoteCommand("move_path", {
      from: "remote://env/home/me/a",
      destParent: "remote://other/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(
    runRemoteCommand("list_dir", { path: "remote://gone/home/me" }),
  ).rejects.toThrow("isn’t connected");
  remoteRequest.mockRejectedValueOnce("Unsupported remote operation");
  await expect(
    runRemoteCommand("list_dir", { path: "remote://env/home/me" }),
  ).rejects.toThrow("Update Terax Host");
  expect(remoteRequest).toHaveBeenCalledTimes(1);
});
