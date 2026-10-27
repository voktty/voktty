// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { runRemoteCommand } from "@/modules/connections/model/remoteCommands";
import { listProjectFiles } from "@/modules/harness/lib/fs";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  use: vi.fn(),
  request: vi.fn(),
  invoke: vi.fn(),
  host: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { use: io.use },
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/connections/model/connections", () => ({
  remoteMachineFor: io.host,
  remoteRequest: io.host,
}));

const profile = { id: "index", name: "Index", host: "index.invalid" };
const root = "remote://voktty-ssh-index/alias/project";
const session = {
  session_id: 71,
  workspace_root: "/actual/project",
  capabilities: [],
};
function git(stdout: string, exitCode = 0) {
  return {
    stdout: btoa(stdout),
    stderr: exitCode ? "not a git repository" : "",
    exitCode,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-index", {
    id: "project",
    name: "Project",
    cwd: "/alias/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  io.use.mockImplementation(async (_key, _connection, action) =>
    action(session),
  );
  io.request.mockResolvedValue(git("file.ts\0nested/other.ts\0"));
});
afterEach(() => {
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("indexes an aliased project through its accepted helper while preserving the saved namespace", async () => {
  await expect(listProjectFiles(root)).resolves.toEqual([
    { name: "file.ts", relative: "file.ts", path: `${root}/file.ts` },
    {
      name: "other.ts",
      relative: "nested/other.ts",
      path: `${root}/nested/other.ts`,
    },
  ]);
  expect(io.use).toHaveBeenCalledWith(
    { profileId: "index", root: "/alias/project" },
    expect.objectContaining({ host: "index.invalid" }),
    expect.any(Function),
  );
  expect(io.request).toHaveBeenCalledExactlyOnceWith(
    71,
    "git.execWorkspace",
    expect.objectContaining({
      cwd: ".",
      args: ["ls-files", "-co", "--exclude-standard", "-z"],
    }),
  );
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.host).not.toHaveBeenCalled();
});

it.each(["/alias/project", "/actual/project"])(
  "scopes a nested checkout to its original folder with accepted root %s",
  async (accepted) => {
    io.use.mockImplementation(async (_key, _connection, action) =>
      action({ ...session, workspace_root: accepted }),
    );
    await expect(listProjectFiles(`${root}/src`)).resolves.toContainEqual({
      name: "file.ts",
      relative: "file.ts",
      path: `${root}/src/file.ts`,
    });
    expect(io.request).toHaveBeenCalledWith(
      71,
      "git.execWorkspace",
      expect.objectContaining({ cwd: "src" }),
    );
  },
);

it("keeps the non-Git walk and its ignore file under the captured nested folder", async () => {
  io.request.mockImplementation(async (_id, method, params) => {
    if (method === "git.execWorkspace") return git("", 128);
    if (method === "fs.readFile") {
      expect(params.path).toBe("src/.gitignore");
      return { content: "skip.ts" };
    }
    if (method === "fs.readDir") {
      if (params.path === "src")
        return {
          entries: [
            { name: "nested", kind: "directory" },
            { name: "skip.ts", kind: "file" },
          ],
        };
      if (params.path === "src/nested")
        return { entries: [{ name: "file.ts", kind: "file" }] };
    }
    throw new Error("Unexpected filesystem target");
  });
  await expect(listProjectFiles(`${root}/src`)).resolves.toEqual([
    {
      name: "file.ts",
      relative: "nested/file.ts",
      path: `${root}/src/nested/file.ts`,
    },
  ]);
  expect(io.invoke).not.toHaveBeenCalled();
});

it("captures index inputs before an asynchronous helper acquisition", async () => {
  let accept!: () => void;
  io.use.mockImplementation(
    (_key, _connection, action) =>
      new Promise((resolve) => {
        accept = () => resolve(action(session));
      }),
  );
  const args = { cwd: `${root}/src` };
  const pending = runRemoteCommand("list_project_files", args);
  args.cwd = `${root}/successor`;
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "successor.invalid" }],
  });
  accept();
  await expect(pending).resolves.toContainEqual({
    name: "file.ts",
    relative: "file.ts",
    path: `${root}/src/file.ts`,
  });
  expect(io.request).toHaveBeenCalledWith(
    71,
    "git.execWorkspace",
    expect.objectContaining({ cwd: "src" }),
  );
});

it("preserves the existing 20000-file index limit", async () => {
  io.request.mockResolvedValue(
    git(Array.from({ length: 20001 }, (_, i) => `file-${i}.ts\0`).join("")),
  );
  expect(await listProjectFiles(root)).toHaveLength(20000);
});

it("does not relax aliased-root restrictions for unrelated Git operations", async () => {
  await expect(
    runRemoteCommand("git_stage_all", { cwd: root }),
  ).rejects.toThrow("saved project root");
  expect(io.request).not.toHaveBeenCalled();
});

it.each([`${root}/literal\\folder`, `${root}/../outside`])(
  "rejects an ambiguous index folder %j before acquisition",
  async (cwd) => {
    await expect(listProjectFiles(cwd)).rejects.toThrow();
    expect(io.use).not.toHaveBeenCalled();
    expect(io.request).not.toHaveBeenCalled();
  },
);

it("rejects traversal entries from a non-Git helper before expanding them", async () => {
  io.use.mockImplementation(async (_key, _connection, action) =>
    action({ ...session, workspace_root: "/alias/project" }),
  );
  io.request.mockImplementation(async (_id, method, params) => {
    if (method === "git.execWorkspace") return git("", 128);
    if (method === "fs.readFile") return { content: "" };
    if (params.path !== ".") throw new Error("Unexpected traversal expansion");
    return { entries: [{ name: "../outside", kind: "directory" }] };
  });
  await expect(listProjectFiles(root)).rejects.toThrow("invalid");
  expect(
    io.request.mock.calls.filter(([, method]) => method === "fs.readDir"),
  ).toHaveLength(1);
});
