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
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiffIndex,
  gitDiffStats,
  gitDiscardFile,
  gitFileDiff,
  gitPull,
  gitPush,
  gitStageAll,
  gitStageContents,
  gitStagedContext,
  gitStageFile,
  gitStash,
  gitSync,
  gitUnstageAll,
  gitUnstageFile,
  listDir,
  readBinaryFile,
  readFilePreview,
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

it("counts untracked direct-profile Git files through the bounded SSH helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  openRemoteWorkspace.mockResolvedValueOnce({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.17",
    capabilities: ["git.execWorkspaceInput", "fs.countTextLines"],
  });
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method === "fs.countTextLines") {
        expect(params.paths).toEqual(["src/binary.bin", "src/new file.ts"]);
        return { lineCounts: [0, 3] };
      }
      if (method !== "git.execWorkspace")
        throw new Error(`Unexpected helper method: ${method}`);
      const args = params.args as string[];
      switch (args[0]) {
        case "status":
          return gitExecResult("? binary.bin\0? new file.ts\0");
        case "diff":
          return gitExecResult("");
        case "remote":
        case "symbolic-ref":
          return gitExecResult("", 1);
        default:
          throw new Error(`Unexpected Git command: ${args.join(" ")}`);
      }
    },
  );

  await expect(
    gitDiffIndex(remotePath(environmentId, "/srv/app/src")),
  ).resolves.toMatchObject({
    files: [
      { relative: "binary.bin", status: "untracked", additions: 0 },
      { relative: "new file.ts", status: "untracked", additions: 3 },
    ],
    additions: 3,
  });
  expect(requestRemoteResult).toHaveBeenCalledWith(9, "fs.countTextLines", {
    paths: ["src/binary.bin", "src/new file.ts"],
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("counts files at the maximum Git index size within the SSH RPC cap", async () => {
  const { environmentId } = registerNativeProfileProject();
  openRemoteWorkspace.mockResolvedValueOnce({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.17",
    capabilities: ["fs.countTextLines"],
  });
  const fileCount = 20_000;
  const status = Array.from(
    { length: fileCount },
    (_, index) => `? file-${index}.txt\0`,
  ).join("");
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method === "fs.countTextLines") {
        return { lineCounts: (params.paths as string[]).map(() => 0) };
      }
      if (method !== "git.execWorkspace")
        throw new Error(`Unexpected helper method: ${method}`);
      const args = params.args as string[];
      if (args[0] === "status") return gitExecResult(status);
      if (args[0] === "diff") return gitExecResult("");
      if (args[0] === "remote" || args[0] === "symbolic-ref")
        return gitExecResult("", 1);
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  const index = await gitDiffIndex(remotePath(environmentId, "/srv/app"));
  expect(index.files).toHaveLength(fileCount);
  expect(
    index.files.find((file) => file.relative === `file-${fileCount - 1}.txt`),
  ).toMatchObject({
    relative: `file-${fileCount - 1}.txt`,
    additions: 0,
  });
  const countCall = requestRemoteResult.mock.calls.find(
    ([, method]) => method === "fs.countTextLines",
  );
  if (!countCall) throw new Error("Expected a bounded line-count request.");
  expect((countCall[2] as { paths: string[] }).paths).toHaveLength(20_000);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("rejects malformed line-count responses from the SSH helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  openRemoteWorkspace.mockResolvedValueOnce({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.17",
    capabilities: ["fs.countTextLines"],
  });
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method === "fs.countTextLines") return { lineCounts: ["3"] };
      if (method !== "git.execWorkspace")
        throw new Error(`Unexpected helper method: ${method}`);
      const args = params.args as string[];
      if (args[0] === "status") return gitExecResult("? new file.ts\0");
      if (args[0] === "diff") return gitExecResult("");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    gitDiffIndex(remotePath(environmentId, "/srv/app")),
  ).rejects.toThrow("The remote helper returned invalid line counts.");
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

it("reads bounded staged Git context through the native SSH helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (
        args[0] === "diff" &&
        args[1] === "--cached" &&
        args[2] === "--stat"
      ) {
        return gitExecResult("src/main.ts | 2 +\n 1 file changed\n");
      }
      if (args[0] === "diff" && args[1] === "--cached") {
        return gitExecResult("diff --git a/src/main.ts b/src/main.ts\n");
      }
      if (args[0] === "symbolic-ref") return gitExecResult("feature/demo\n");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    gitStagedContext(remotePath(environmentId, "/srv/app/src")),
  ).resolves.toEqual({
    branch: "feature/demo",
    summary: "src/main.ts | 2 +\n 1 file changed\n",
    patch: "diff --git a/src/main.ts b/src/main.ts\n",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("returns an empty commit history for a saved SSH folder outside Git", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce(
    gitExecResult("", 128, "fatal: not a git repository"),
  );

  await expect(
    runRemoteCommand("git_history", {
      cwd: remotePath(environmentId, "/srv/app"),
    }),
  ).resolves.toEqual({ head: null, commits: [] });
  expect(requestRemoteResult).toHaveBeenCalledTimes(1);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("includes unstaged changes and untracked names in remote commit context", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "diff" && args[1] === "--cached") {
        return gitExecResult("");
      }
      if (args[0] === "diff" && args[1] === "HEAD" && args[2] === "--stat") {
        return gitExecResult("tracked.txt | 1 +\n");
      }
      if (args[0] === "diff" && args[1] === "HEAD") {
        return gitExecResult("diff --git a/tracked.txt b/tracked.txt\n");
      }
      if (args[0] === "ls-files") return gitExecResult("new file.txt\n");
      if (args[0] === "symbolic-ref") return gitExecResult("", 1);
      if (args[0] === "rev-parse") return gitExecResult("abc1234\n");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    gitStagedContext(remotePath(environmentId, "/srv/app")),
  ).resolves.toEqual({
    branch: "abc1234",
    summary: "tracked.txt | 1 +\n\nUntracked files:\nnew file.txt",
    patch: "diff --git a/tracked.txt b/tracked.txt\n",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("commits remote staged changes with bounded message and helper timeout", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse") return gitExecResult("/srv/app\n");
      if (args[0] === "commit") {
        return { ...gitExecResult(""), stderrTruncated: true };
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await gitCommit(
    remotePath(environmentId, "/srv/app"),
    "  fix: quote 'paths' safely\n",
  );

  expect(requestRemoteResult).toHaveBeenLastCalledWith(9, "git.execWorkspace", {
    cwd: ".",
    args: ["commit", "--cleanup=strip", "-m", "fix: quote 'paths' safely"],
    timeoutSecs: 120,
    maxOutputBytes: 64 * 1024,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("creates a selected-file SSH commit and returns its commit metadata", async () => {
  const { environmentId } = registerNativeProfileProject();
  const commitSha = "a".repeat(40);
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app/repo\n");
      }
      if (args[0] === "status") {
        return gitExecResult(
          "1 .M N... 100644 100644 100644 abc def src/my file.ts\0",
        );
      }
      if (args[0] === "commit") return gitExecResult("");
      if (args[0] === "show") {
        return gitExecResult(`${commitSha}\0fix: selected file`);
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_commit", {
      cwd: remotePath(environmentId, "/srv/app/repo"),
      paths: [remotePath(environmentId, "/srv/app/repo/src/my file.ts")],
      message: "fix: selected file",
    }),
  ).resolves.toEqual({ commitSha, summary: "fix: selected file" });
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toEqual([
    ["rev-parse", "--show-toplevel"],
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "--ahead-behind",
      "--untracked-files=all",
      "-z",
    ],
    [
      "commit",
      "--only",
      "-m",
      "fix: selected file",
      "--",
      ":(literal)src/my file.ts",
    ],
    ["show", "-s", "--format=%H%x00%s", "HEAD"],
  ]);
  expect(requestRemoteResult.mock.calls[2][2]).toMatchObject({
    timeoutSecs: 120,
    maxOutputBytes: 64 * 1024,
  });
});

it("stages only a selected untracked file before a native SSH commit", async () => {
  const { environmentId } = registerNativeProfileProject();
  const commitSha = "b".repeat(40);
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "status") {
        return gitExecResult("? new file.ts\0? unrelated untracked.ts\0");
      }
      if (args[0] === "add" || args[0] === "commit") {
        return gitExecResult("");
      }
      if (args[0] === "show") return gitExecResult(`${commitSha}\0Added file`);
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_commit", {
      cwd: remotePath(environmentId, "/srv/app"),
      paths: [remotePath(environmentId, "/srv/app/new file.ts")],
      message: "Add file",
    }),
  ).resolves.toEqual({ commitSha, summary: "Added file" });
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toEqual([
    ["rev-parse", "--show-toplevel"],
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "--ahead-behind",
      "--untracked-files=all",
      "-z",
    ],
    ["add", "--", ":(literal)new file.ts"],
    ["commit", "--only", "-m", "Add file", "--", ":(literal)new file.ts"],
    ["show", "-s", "--format=%H%x00%s", "HEAD"],
  ]);
  expect(requestRemoteResult.mock.calls[2][2]).toMatchObject({
    maxOutputBytes: 64 * 1024,
  });
});

it("reads commit patches and routes tag reads and writes through native SSH", async () => {
  const { environmentId } = registerNativeProfileProject();
  const commitSha = "a".repeat(40);
  const tagObjectSha = "b".repeat(40);
  const tagOutput =
    ["v1.0", tagObjectSha, commitSha, "tag", "1700000000", "Release 1.0"].join(
      "\0",
    ) +
    "\n" +
    ["v0.9", commitSha, "", "commit", "1690000000", ""].join("\0") +
    "\n";
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return gitExecResult(`${commitSha}\n`);
      }
      if (args[0] === "show") {
        return { ...gitExecResult("partial patch"), stdoutTruncated: true };
      }
      if (args[0] === "tag" && args[1] === "--sort=-creatordate") {
        return gitExecResult(tagOutput);
      }
      if (args[0] === "check-ref-format") return gitExecResult("");
      if (args[0] === "tag" && args[1] === "-a") return gitExecResult("");
      if (args[0] === "tag" && args[1] === "-d") return gitExecResult("");
      if (args[0] === "push") return gitExecResult("");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  const cwd = remotePath(environmentId, "/srv/app");
  await expect(
    runRemoteCommand("git_show_commit", { cwd, sha: commitSha }),
  ).resolves.toEqual({ diffText: "partial patch", truncated: true });
  await expect(runRemoteCommand("git_tag_list", { cwd })).resolves.toEqual([
    {
      name: "v1.0",
      sha: commitSha,
      annotated: true,
      message: "Release 1.0",
      timestampSecs: 1700000000,
    },
    {
      name: "v0.9",
      sha: commitSha,
      annotated: false,
      message: null,
      timestampSecs: 1690000000,
    },
  ]);
  await expect(
    runRemoteCommand("git_tag_create", {
      cwd,
      name: "v1.1",
      targetSha: commitSha,
      message: "Release 1.1",
    }),
  ).resolves.toBeUndefined();
  await expect(
    runRemoteCommand("git_tag_delete", { cwd, name: "v1.1" }),
  ).resolves.toBeUndefined();
  await expect(
    runRemoteCommand("git_tag_push", { cwd, name: "v1.0" }),
  ).resolves.toBeUndefined();
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toContainEqual(["push", "origin", "v1.0"]);
  const pushCall = requestRemoteResult.mock.calls.find(
    ([, method, params]) =>
      method === "git.execWorkspace" &&
      (params as { args: string[] }).args[0] === "push",
  );
  expect(pushCall?.[2]).toMatchObject({
    timeoutSecs: 180,
    maxOutputBytes: 64 * 1024,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("rejects unsafe Git tag names before running tag mutations", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_tag_delete", {
      cwd: remotePath(environmentId, "/srv/app"),
      name: "--delete-all",
    }),
  ).rejects.toThrow("tag name is invalid");
  expect(requestRemoteResult).toHaveBeenCalledTimes(1);
});

it("routes Git History branch, cherry-pick, revert, and conflict actions through SSH", async () => {
  const { environmentId } = registerNativeProfileProject();
  const sourceSha = "a".repeat(40);
  const resultSha = "b".repeat(40);
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "check-ref-format") {
        return gitExecResult(`${args[2]}\n`);
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return gitExecResult(`${sourceSha}\n`);
      }
      if (
        args[0] === "rev-parse" &&
        args[1] === "-q" &&
        args[3] === "MERGE_HEAD"
      ) {
        return gitExecResult("", 1);
      }
      if (
        args[0] === "rev-parse" &&
        args[1] === "-q" &&
        args[3] === "CHERRY_PICK_HEAD"
      ) {
        return gitExecResult(`${sourceSha}\n`);
      }
      if (args[0] === "rev-parse" && args[1] === "-q") {
        return gitExecResult("", 1);
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return gitExecResult(`${resultSha}\n`);
      }
      if (
        args[0] === "checkout" ||
        args[0] === "cherry-pick" ||
        args[0] === "revert" ||
        args[0] === "-c"
      ) {
        return gitExecResult("");
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  const cwd = remotePath(environmentId, "/srv/app");
  await expect(
    runRemoteCommand("git_branch_from_commit", {
      cwd,
      name: "feature/from-commit",
      sha: sourceSha,
    }),
  ).resolves.toBeUndefined();
  await expect(
    runRemoteCommand("git_cherry_pick_commit", { cwd, sha: sourceSha }),
  ).resolves.toBe(resultSha);
  await expect(
    runRemoteCommand("git_revert_commit", { cwd, sha: sourceSha }),
  ).resolves.toBe(resultSha);
  await expect(
    runRemoteCommand("git_operation_status", { cwd }),
  ).resolves.toEqual({ kind: "cherryPick" });
  await expect(
    runRemoteCommand("git_operation_abort", { cwd, kind: "revert" }),
  ).resolves.toBeUndefined();
  await expect(
    runRemoteCommand("git_operation_continue", { cwd, kind: "cherryPick" }),
  ).resolves.toBeUndefined();

  const gitCalls = requestRemoteResult.mock.calls
    .filter(([, method]) => method === "git.execWorkspace")
    .map(([, , params]) => (params as { args: string[] }).args);
  expect(gitCalls).toContainEqual([
    "checkout",
    "-b",
    "feature/from-commit",
    sourceSha,
  ]);
  expect(gitCalls).toContainEqual(["cherry-pick", sourceSha]);
  expect(gitCalls).toContainEqual(["revert", "--no-edit", sourceSha]);
  expect(gitCalls).toContainEqual(["revert", "--abort"]);
  expect(gitCalls).toContainEqual([
    "-c",
    "core.editor=true",
    "cherry-pick",
    "--continue",
  ]);
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method, params]) => {
        const args = (params as { args: string[] }).args;
        return (
          method === "git.execWorkspace" &&
          (args[0] === "checkout" ||
            args[0] === "cherry-pick" ||
            args[0] === "revert" ||
            args[0] === "-c")
        );
      })
      .every(
        ([, , params]) =>
          (params as { timeoutSecs: number }).timeoutSecs === 30,
      ),
  ).toBe(true);

  await expect(
    runRemoteCommand("git_operation_abort", { cwd, kind: "toString" }),
  ).rejects.toThrow("Git operation kind is invalid");
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("rejects invalid SSH branch names and commit refs before Git mutations", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "check-ref-format") return gitExecResult("", 1);
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return gitExecResult("", 1);
      }
      throw new Error("Unexpected Git command");
    },
  );

  const cwd = remotePath(environmentId, "/srv/app");
  await expect(
    runRemoteCommand("git_branch_from_commit", {
      cwd,
      name: "--delete",
      sha: "a".repeat(40),
    }),
  ).rejects.toThrow("not a valid branch name");
  await expect(
    runRemoteCommand("git_cherry_pick_commit", { cwd, sha: "--delete" }),
  ).rejects.toThrow("Invalid commit");
  await expect(
    runRemoteCommand("git_revert_commit", { cwd, sha: "a".repeat(40) }),
  ).rejects.toThrow("Unknown commit");

  const gitCalls = requestRemoteResult.mock.calls
    .filter(([, method]) => method === "git.execWorkspace")
    .map(([, , params]) => (params as { args: string[] }).args);
  expect(
    gitCalls.some((args) =>
      ["checkout", "cherry-pick", "revert"].includes(args[0]),
    ),
  ).toBe(false);
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("compares native SSH branches with bounded logs and safe file metadata", async () => {
  const { environmentId } = registerNativeProfileProject();
  const sha = "a".repeat(40);
  const parentSha = "b".repeat(40);
  const logLine = [
    sha,
    "Ada Lovelace",
    "ada@example.test",
    "1700000000",
    parentSha,
    "Add remote feature",
  ].join("\x1f");
  const nameStatusOutput = [
    "M",
    "src/a\tfile.ts",
    "R100",
    "src/old.ts",
    "src/new file.ts",
    "",
  ].join("\0");
  const numstatOutput = [
    "3\t1\tsrc/a\tfile.ts",
    "0\t0\t",
    "src/old.ts",
    "src/new file.ts",
    "",
  ].join("\0");
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "check-ref-format") {
        return gitExecResult(`${args[2]}\n`);
      }
      if (args[0] === "log") {
        return args[3] === "main..feature/remote"
          ? gitExecResult(`${logLine}\n`)
          : gitExecResult("");
      }
      if (args[0] === "diff" && args.includes("--name-status")) {
        return gitExecResult(nameStatusOutput);
      }
      if (args[0] === "diff" && args.includes("--numstat")) {
        return gitExecResult(numstatOutput);
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_compare_branches", {
      cwd: remotePath(environmentId, "/srv/app"),
      base: "main",
      compare: "feature/remote",
    }),
  ).resolves.toEqual({
    ahead: [
      {
        sha,
        shortSha: sha.slice(0, 7),
        author: "Ada Lovelace",
        authorEmail: "ada@example.test",
        timestampSecs: 1700000000,
        parents: [parentSha],
        subject: "Add remote feature",
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      },
    ],
    behind: [],
    files: [
      {
        path: "src/a\tfile.ts",
        originalPath: null,
        status: "M",
        statusLabel: "Modified",
        added: 3,
        removed: 1,
        isBinary: false,
      },
      {
        path: "src/new file.ts",
        originalPath: "src/old.ts",
        status: "R",
        statusLabel: "Renamed",
        added: 0,
        removed: 0,
        isBinary: false,
      },
    ],
  });
  const gitCalls = requestRemoteResult.mock.calls
    .filter(([, method]) => method === "git.execWorkspace")
    .map(([, , params]) => (params as { args: string[] }).args);
  expect(gitCalls).toContainEqual([
    "log",
    "--no-color",
    "--format=%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s",
    "main..feature/remote",
  ]);
  expect(gitCalls).toContainEqual([
    "diff",
    "--no-commit-id",
    "-r",
    "-z",
    "--name-status",
    "main...feature/remote",
  ]);
  expect(gitCalls).toContainEqual([
    "diff",
    "--no-commit-id",
    "-r",
    "-z",
    "--numstat",
    "main...feature/remote",
  ]);
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method, params]) => {
        const args = (params as { args: string[] }).args;
        return (
          method === "git.execWorkspace" &&
          (args[0] === "log" || args[0] === "diff")
        );
      })
      .every(([, , params]) => {
        const options = params as {
          timeoutSecs: number;
          maxOutputBytes: number;
        };
        return (
          options.timeoutSecs === 30 &&
          options.maxOutputBytes === 4 * 1024 * 1024
        );
      }),
  ).toBe(true);

  requestRemoteResult.mockClear();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      _method: string,
      params: Record<string, unknown>,
    ) => {
      const args = params.args as string[];
      if (args[1] === "--show-toplevel") return gitExecResult("/srv/app\n");
      if (args[0] === "check-ref-format") {
        return gitExecResult(`${args[2]}\n`);
      }
      if (args.includes("--name-status")) {
        return gitExecResult(["M", "../outside.ts", ""].join("\0"));
      }
      if (args.includes("--numstat")) {
        return gitExecResult("1\t0\t../outside.ts\0");
      }
      return gitExecResult("");
    },
  );
  await expect(
    runRemoteCommand("git_compare_branches", {
      cwd: remotePath(environmentId, "/srv/app"),
      base: "main",
      compare: "feature/remote",
    }),
  ).rejects.toThrow("outside the project");
});

it("refuses to read or commit a Git repository above the saved project root", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      _method: string,
      params: Record<string, unknown>,
    ) => {
      const args = params.args as string[];
      return args[1] === "--is-inside-work-tree"
        ? gitExecResult("true\n")
        : gitExecResult("/srv\n");
    },
  );

  await expect(
    gitStagedContext(remotePath(environmentId, "/srv/app")),
  ).rejects.toThrow("Git repository root is outside the saved project");
  await expect(
    runRemoteCommand("git_history", {
      cwd: remotePath(environmentId, "/srv/app"),
    }),
  ).rejects.toThrow("Git repository root is outside the saved project");
  await expect(
    runRemoteCommand("git_commit_files", {
      cwd: remotePath(environmentId, "/srv/app"),
      sha: "a".repeat(40),
    }),
  ).rejects.toThrow("Git repository root is outside the saved project");
  await expect(
    runRemoteCommand("git_commit_file_diff", {
      cwd: remotePath(environmentId, "/srv/app"),
      sha: "a".repeat(40),
      relative: "file.ts",
    }),
  ).rejects.toThrow("Git repository root is outside the saved project");
  await expect(
    gitCommit(remotePath(environmentId, "/srv/app"), "fix: keep root"),
  ).rejects.toThrow("Git repository root is outside the saved project");
  expect(requestRemoteResult).toHaveBeenCalledTimes(6);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledTimes(5);
});

it("rejects oversized remote commit messages before invoking Git", async () => {
  const { environmentId } = registerNativeProfileProject();

  await expect(
    gitCommit(remotePath(environmentId, "/srv/app"), "é".repeat(8 * 1024 + 1)),
  ).rejects.toThrow("Commit message is too large");
  expect(requestRemoteResult).not.toHaveBeenCalled();
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("sets the upstream to origin on the first native SSH push", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "rev-parse") return gitExecResult("", 1);
      if (args[0] === "remote") return gitExecResult("backup\norigin\n");
      if (args[0] === "push") return gitExecResult("Everything up-to-date\n");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await gitPush(remotePath(environmentId, "/srv/app"));

  expect(requestRemoteResult).toHaveBeenLastCalledWith(9, "git.execWorkspace", {
    cwd: ".",
    args: ["push", "-u", "--", "origin", "HEAD"],
    timeoutSecs: 180,
    maxOutputBytes: 64 * 1024,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("returns native SSH push metadata and uses a bounded network timeout", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return args[2] === "@{upstream}"
          ? gitExecResult("origin/feature/demo\n")
          : gitExecResult("feature/demo\n");
      }
      if (args[0] === "push") return gitExecResult("Everything up-to-date\n");
      if (args[0] === "remote") return gitExecResult("origin\n");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_push", {
      cwd: remotePath(environmentId, "/srv/app"),
    }),
  ).resolves.toEqual({
    remote: "origin",
    branch: "feature/demo",
    pushed: true,
  });
  expect(requestRemoteResult).toHaveBeenCalledWith(9, "git.execWorkspace", {
    cwd: ".",
    args: ["push"],
    timeoutSecs: 180,
    maxOutputBytes: 64 * 1024,
  });
});

it("fetches and reads a configured remote URL through the native SSH helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "remote") return gitExecResult("origin\n");
      if (args[0] === "config") {
        expect(args).toEqual(["config", "--get", "remote.origin.url"]);
        return gitExecResult("ssh://git.example/group/project.git\n");
      }
      if (args[0] === "fetch") return gitExecResult("");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  const cwd = remotePath(environmentId, "/srv/app");
  await expect(
    runRemoteCommand("git_remote_url", { cwd, name: "origin" }),
  ).resolves.toBe("ssh://git.example/group/project.git");
  await expect(runRemoteCommand("git_fetch", { cwd })).resolves.toBeUndefined();
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toEqual([
    ["rev-parse", "--show-toplevel"],
    ["remote"],
    ["config", "--get", "remote.origin.url"],
    ["rev-parse", "--show-toplevel"],
    ["fetch", "--prune"],
  ]);
  expect(requestRemoteResult.mock.calls[4][2]).toMatchObject({
    timeoutSecs: 180,
    maxOutputBytes: 64 * 1024,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledTimes(2);
});

it("returns no URL for an invalid remote name without invoking Git config", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_remote_url", {
      cwd: remotePath(environmentId, "/srv/app"),
      name: "origin;touch",
    }),
  ).resolves.toBeNull();
  expect(requestRemoteResult).toHaveBeenCalledTimes(1);
});

it("pulls only by fast-forward and syncs by pull then push", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "rev-parse") return gitExecResult("origin/main\n");
      if (args[0] === "pull" || args[0] === "push") return gitExecResult("");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  const cwd = remotePath(environmentId, "/srv/app");
  await gitPull(cwd);
  await gitSync(cwd);

  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toEqual([
    ["rev-parse", "--show-toplevel"],
    ["pull", "--ff-only"],
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--abbrev-ref", "@{upstream}"],
    ["pull", "--no-edit", "--ff"],
    ["push"],
  ]);
  expect(requestRemoteResult.mock.calls[1][2]).toMatchObject({
    timeoutSecs: 180,
    maxOutputBytes: 64 * 1024,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledTimes(2);
});

it("syncs a branch without upstream by setting its selected remote", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "rev-parse") return gitExecResult("", 1);
      if (args[0] === "remote") return gitExecResult("upstream\n");
      if (args[0] === "push") return gitExecResult("");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await gitSync(remotePath(environmentId, "/srv/app"));

  expect(
    requestRemoteResult.mock.calls.map(
      ([, , params]) => (params as { args: string[] }).args,
    ),
  ).toEqual([
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--abbrev-ref", "@{upstream}"],
    ["remote"],
    ["push", "-u", "--", "upstream", "HEAD"],
  ]);
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("lists local and remote-only branches through the native SSH helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return gitExecResult("true\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "symbolic-ref") return gitExecResult("feature/demo\n");
      if (args[0] === "rev-parse") return gitExecResult("abc1234\n");
      if (args[0] === "for-each-ref" && args[2] === "refs/heads") {
        return gitExecResult("feature/demo\t*\nmain\t \nrelease\t \n");
      }
      if (args[0] === "for-each-ref" && args[2] === "refs/remotes") {
        return gitExecResult(
          "origin/main\norigin/feat/remote-only\nbackup/feat/remote-only\norigin/HEAD\norigin/foo/HEAD\norigin/feat/demo\n",
        );
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    gitBranches(remotePath(environmentId, "/srv/app")),
  ).resolves.toEqual({
    current: "feature/demo",
    detached: false,
    branches: [
      { name: "feature/demo", current: true, remote: null },
      { name: "main", current: false, remote: null },
      { name: "release", current: false, remote: null },
      { name: "feat/demo", current: false, remote: "origin" },
      { name: "feat/remote-only", current: false, remote: "backup" },
      { name: "feat/remote-only", current: false, remote: "origin" },
    ],
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("returns an empty branch list for a saved SSH folder outside Git", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce(gitExecResult("", 128));

  await expect(
    gitBranches(remotePath(environmentId, "/srv/app")),
  ).resolves.toEqual({
    current: null,
    detached: false,
    branches: [],
  });
  expect(requestRemoteResult).toHaveBeenCalledTimes(1);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("loads bounded commit history through the native SSH helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  const head = "a".repeat(40);
  const parent = "b".repeat(40);
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return gitExecResult("true\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (
        args[0] === "rev-parse" &&
        args[1] === "--verify" &&
        args[2] === "HEAD"
      ) {
        return gitExecResult(`${head}\n`);
      }
      if (args[0] === "remote") return gitExecResult("origin\n");
      if (args[0] === "log") {
        expect(args).toContain("--max-count=3");
        expect(args[args.length - 1]).toBe("--all");
        return gitExecResult(
          `${head}\0${head.slice(0, 7)}\0${parent}\0Ada\0${1700000000}\0` +
            "HEAD -> main, origin/main, tag: v1.0\0Add feature\x1e\n",
        );
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_history", {
      cwd: remotePath(environmentId, "/srv/app"),
      limit: 3,
      allRefs: true,
    }),
  ).resolves.toEqual({
    repoRoot: remotePath(environmentId, "/srv/app"),
    head,
    commits: [
      {
        sha: head,
        shortSha: head.slice(0, 7),
        parents: [parent],
        author: "Ada",
        timestamp: 1700000000,
        subject: "Add feature",
        refs: [
          { name: "main", kind: "local" },
          { name: "origin/main", kind: "remote" },
          { name: "v1.0", kind: "tag" },
        ],
        head: true,
      },
    ],
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("lists files and reads commit diffs through root-confined Git calls", async () => {
  const { environmentId } = registerNativeProfileProject();
  const sha = "a".repeat(40);
  const parent = "b".repeat(40);
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return gitExecResult(
          `${args[2] === `${sha}^{commit}` ? sha : parent}\n`,
        );
      }
      if (args[0] === "diff-tree" && args.includes("--name-status")) {
        return gitExecResult("A\0new file.ts\0M\0changed.ts\0");
      }
      if (args[0] === "diff-tree" && args.includes("--numstat")) {
        return gitExecResult("2\t0\tnew file.ts\0" + "1\t1\tchanged.ts\0");
      }
      if (args[0] === "show" && args[3] === `${parent}:changed.ts`) {
        return gitExecResult("before\n");
      }
      if (args[0] === "show" && args[3] === `${sha}:changed.ts`) {
        return gitExecResult("after\n");
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_commit_files", {
      cwd: remotePath(environmentId, "/srv/app"),
      sha,
    }),
  ).resolves.toEqual([
    {
      path: remotePath(environmentId, "/srv/app/new file.ts"),
      relative: "new file.ts",
      status: "added",
      additions: 2,
      deletions: 0,
      binary: false,
      staged: false,
      unstaged: false,
    },
    {
      path: remotePath(environmentId, "/srv/app/changed.ts"),
      relative: "changed.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      staged: false,
      unstaged: false,
    },
  ]);
  await expect(
    runRemoteCommand("git_commit_file_diff", {
      cwd: remotePath(environmentId, "/srv/app"),
      sha,
      relative: "changed.ts",
    }),
  ).resolves.toEqual({
    path: remotePath(environmentId, "/srv/app/changed.ts"),
    relative: "changed.ts",
    status: "modified",
    original: "before\n",
    current: "after\n",
    binary: false,
    tooLarge: false,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledTimes(2);
});

it("marks truncated commit blobs as too large without returning partial text", async () => {
  const { environmentId } = registerNativeProfileProject();
  const sha = "a".repeat(40);
  const parent = "b".repeat(40);
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return gitExecResult(
          `${args[2] === `${sha}^{commit}` ? sha : parent}\n`,
        );
      }
      if (args[0] === "show") {
        return { ...gitExecResult("partial"), stdoutTruncated: true };
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    runRemoteCommand("git_commit_file_diff", {
      cwd: remotePath(environmentId, "/srv/app"),
      sha,
      relative: "large.txt",
    }),
  ).resolves.toMatchObject({
    original: "",
    current: "",
    binary: false,
    tooLarge: true,
  });
});

it("rejects invalid history paths and commit ids before invoking unsafe Git args", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValue(gitExecResult("/srv/app\n"));
  await expect(
    runRemoteCommand("git_commit_file_diff", {
      cwd: remotePath(environmentId, "/srv/app"),
      sha: "--help",
      relative: "../secret.txt",
    }),
  ).rejects.toThrow("outside the project");
  await expect(
    runRemoteCommand("git_commit_files", {
      cwd: remotePath(environmentId, "/srv/app"),
      sha: "--help",
    }),
  ).rejects.toThrow("Invalid commit");
  expect(
    requestRemoteResult.mock.calls.map(
      ([, , params]) => (params as { args: string[] }).args,
    ),
  ).toEqual([["rev-parse", "--show-toplevel"]]);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("checks out a selected remote branch with a local tracking branch", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "check-ref-format" && args[1] === "--branch") {
        return gitExecResult(`${args[2]}\n`);
      }
      if (args[0] === "symbolic-ref") return gitExecResult("main\n");
      if (args[0] === "remote") return gitExecResult("origin\n");
      if (args[0] === "check-ref-format") return gitExecResult("");
      if (args[0] === "show-ref") return gitExecResult("");
      if (args[0] === "checkout") return gitExecResult("");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    gitCheckout(
      remotePath(environmentId, "/srv/app"),
      "feature/remote",
      "origin",
    ),
  ).resolves.toBe("feature/remote");
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toContainEqual([
    "checkout",
    "--track",
    "-b",
    "feature/remote",
    "origin/feature/remote",
  ]);
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("rejects invalid remote branch names before running a checkout", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "check-ref-format") return gitExecResult("", 1);
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    gitCheckout(remotePath(environmentId, "/srv/app"), "bad branch"),
  ).rejects.toThrow("'bad branch' is not a valid branch name");
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toContainEqual(["check-ref-format", "--branch", "bad branch"]);
  expect(requestRemoteResult).not.toHaveBeenCalledWith(
    9,
    "git.execWorkspace",
    expect.objectContaining({ args: expect.arrayContaining(["checkout"]) }),
  );
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("normalizes a remote checkout blocked by local changes", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "check-ref-format") return gitExecResult("main\n");
      if (args[0] === "symbolic-ref") return gitExecResult("feature\n");
      if (args[0] === "show-ref") return gitExecResult("");
      if (args[0] === "checkout") {
        return gitExecResult(
          "",
          1,
          "error: Your local changes to the following files would be overwritten by checkout.\nPlease commit your changes or stash them before you switch branches.\n",
        );
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  await expect(
    gitCheckout(remotePath(environmentId, "/srv/app"), "main"),
  ).rejects.toThrow(
    "Your local changes would be overwritten. Commit or stash them first.",
  );
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("creates remote branches and stashes tracked plus untracked changes", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "check-ref-format") return gitExecResult("feature/new\n");
      if (args[0] === "show-ref") return gitExecResult("", 1);
      if (args[0] === "symbolic-ref") return gitExecResult("main\n");
      if (args[0] === "checkout" || args[0] === "stash") {
        return gitExecResult("");
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  );

  const cwd = remotePath(environmentId, "/srv/app");
  await expect(gitCreateBranch(cwd, "feature/new")).resolves.toBe(
    "feature/new",
  );
  await gitStash(cwd, "  WIP before checkout  ");
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method]) => method === "git.execWorkspace")
      .map(([, , params]) => (params as { args: string[] }).args),
  ).toEqual(
    expect.arrayContaining([
      ["checkout", "-b", "feature/new"],
      ["stash", "push", "--include-untracked", "-m", "WIP before checkout"],
    ]),
  );
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledTimes(2);
});

it("lists and mutates Git History stashes through bounded native SSH Git calls", async () => {
  const { environmentId } = registerNativeProfileProject();
  const firstSha = "a".repeat(40);
  const secondSha = "b".repeat(40);
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "git.execWorkspace")
        throw new Error("Unexpected helper method");
      const args = params.args as string[];
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return gitExecResult("/srv/app\n");
      }
      if (args[0] === "stash" && args[1] === "list") {
        const separator = "\x1f";
        return gitExecResult(
          [
            [firstSha, "1700000000", "WIP first"].join(separator),
            [secondSha, "1700000001", "WIP second"].join(separator),
            "",
          ].join("\n"),
        );
      }
      if (args[0] === "stash") return gitExecResult("");
      throw new Error("Unexpected Git command");
    },
  );

  const cwd = remotePath(environmentId, "/srv/app");
  await expect(runRemoteCommand("git_stash_list", { cwd })).resolves.toEqual([
    {
      index: 0,
      sha: firstSha,
      timestampSecs: 1700000000,
      message: "WIP first",
    },
    {
      index: 1,
      sha: secondSha,
      timestampSecs: 1700000001,
      message: "WIP second",
    },
  ]);
  await expect(
    runRemoteCommand("git_stash_save", {
      cwd,
      message: "  keep staged  ",
      includeUntracked: false,
    }),
  ).resolves.toBeUndefined();
  await expect(
    runRemoteCommand("git_stash_apply", { cwd, index: 1 }),
  ).resolves.toBeUndefined();
  await expect(
    runRemoteCommand("git_stash_pop", { cwd, index: 0 }),
  ).resolves.toBeUndefined();
  await expect(
    runRemoteCommand("git_stash_drop", { cwd, index: 1 }),
  ).resolves.toBeUndefined();

  const mutationCalls = requestRemoteResult.mock.calls
    .filter(([, method, params]) => {
      const args = (params as { args: string[] }).args;
      return (
        method === "git.execWorkspace" &&
        args[0] === "stash" &&
        args[1] !== "list"
      );
    })
    .map(([, , params]) => (params as { args: string[] }).args);
  expect(mutationCalls).toEqual([
    ["stash", "push", "-m", "keep staged"],
    ["stash", "apply", "stash@{1}"],
    ["stash", "pop", "stash@{0}"],
    ["stash", "drop", "stash@{1}"],
  ]);
  expect(
    requestRemoteResult.mock.calls
      .filter(([, method, params]) => {
        const args = (params as { args: string[] }).args;
        return (
          method === "git.execWorkspace" &&
          args[0] === "stash" &&
          ["apply", "pop", "drop"].includes(args[1])
        );
      })
      .every(
        ([, , params]) =>
          (params as { timeoutSecs: number }).timeoutSecs === 30,
      ),
  ).toBe(true);

  requestRemoteResult.mockClear();
  await expect(
    runRemoteCommand("git_stash_apply", { cwd, index: -1 }),
  ).rejects.toThrow("Git stash index is invalid");
  await expect(
    runRemoteCommand("git_stash_save", {
      cwd,
      message: "invalid option",
      includeUntracked: "false",
    }),
  ).rejects.toThrow("include-untracked option is invalid");
  expect(
    requestRemoteResult.mock.calls.filter(([, method, params]) => {
      const args = (params as { args: string[] }).args;
      return method === "git.execWorkspace" && args[0] === "stash";
    }),
  ).toHaveLength(0);
  await expect(
    runRemoteCommand("git_stash_list", { cwd: "remote://env/srv/app" }),
  ).rejects.toThrow("This isn’t available for projects on another machine");
  expect(remoteRequest).not.toHaveBeenCalled();
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

it("previews direct-profile SSH files through the bounded helper capability", async () => {
  const { environmentId } = registerNativeProfileProject();
  openRemoteWorkspace.mockResolvedValueOnce({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.17",
    capabilities: ["fs.readFilePreview"],
  });
  requestRemoteResult.mockResolvedValueOnce({ lines: ["third", "fourth"] });

  await expect(
    readFilePreview(remotePath(environmentId, "/srv/app/src/note.txt"), 2, 3),
  ).resolves.toEqual(["third", "fourth"]);
  expect(requestRemoteResult).toHaveBeenCalledWith(9, "fs.readFilePreview", {
    path: "src/note.txt",
    maxLines: 2,
    startLine: 3,
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("falls back to bounded full-file reads for older SSH helpers", async () => {
  const { environmentId } = registerNativeProfileProject();
  openRemoteWorkspace.mockResolvedValueOnce({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.16",
    capabilities: [],
  });
  requestRemoteResult.mockResolvedValueOnce({
    content: "first\nsecond\nthird\n",
  });

  await expect(
    readFilePreview(remotePath(environmentId, "/srv/app/note.txt"), 1, 2),
  ).resolves.toEqual(["second"]);
  expect(requestRemoteResult).toHaveBeenCalledWith(9, "fs.readFile", {
    path: "note.txt",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("rejects oversized line previews from an SSH helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  openRemoteWorkspace.mockResolvedValueOnce({
    session_id: 9,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.17",
    capabilities: ["fs.readFilePreview"],
  });
  requestRemoteResult.mockResolvedValueOnce({
    lines: ["x".repeat(1025)],
  });

  await expect(
    readFilePreview(remotePath(environmentId, "/srv/app/note.txt")),
  ).rejects.toThrow("The remote helper returned an invalid file preview.");
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
    .mockResolvedValueOnce(
      gitExecResult("", 128, "fatal: not a git repository"),
    )
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

it("lists saved SSH project files with Git ignore rules through the native helper", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockImplementation(
    async (
      _sessionId: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      expect(method).toBe("git.execWorkspace");
      expect(params).toMatchObject({
        cwd: ".",
        args: ["ls-files", "-co", "--exclude-standard", "-z"],
        maxOutputBytes: 4 * 1024 * 1024,
      });
      return gitExecResult(
        "README.md\0src/main.ts\0docs/notes\nwith-newline.md\0.DS_Store\0node_modules/pkg/index.js\0",
      );
    },
  );

  await expect(
    runRemoteCommand("list_project_files", {
      cwd: remotePath(environmentId, "/srv/app"),
    }),
  ).resolves.toEqual([
    {
      name: "notes\nwith-newline.md",
      relative: "docs/notes\nwith-newline.md",
      path: remotePath(environmentId, "/srv/app/docs/notes\nwith-newline.md"),
    },
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
  expect(closeRemoteWorkspace).toHaveBeenCalledWith(9);
});

it("drops the incomplete trailing Git path when the helper listing is truncated", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce({
    ...gitExecResult("complete.ts\0partial"),
    stdoutTruncated: true,
  });

  await expect(
    runRemoteCommand("list_project_files", {
      cwd: remotePath(environmentId, "/srv/app"),
    }),
  ).resolves.toEqual([
    {
      name: "complete.ts",
      relative: "complete.ts",
      path: remotePath(environmentId, "/srv/app/complete.ts"),
    },
  ]);
});

it("rejects Git file listings that escape the saved SSH project", async () => {
  const { environmentId } = registerNativeProfileProject();
  requestRemoteResult.mockResolvedValueOnce(gitExecResult("../outside.ts\0"));

  await expect(
    runRemoteCommand("list_project_files", {
      cwd: remotePath(environmentId, "/srv/app"),
    }),
  ).rejects.toThrow(
    "The remote Git file listing contains a path outside the project.",
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
