// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { readCapturedProjectIndex } from "@/modules/connections/model/remoteCommands";

const io = vi.hoisted(() => ({
  use: vi.fn(),
  request: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { use: io.use },
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
const profile = { id: "fixture", name: "Fixture", host: "fixture.invalid" };
const project = {
  key: "fixture",
  projectId: "fixture",
  environmentId: "voktty-ssh-fixture",
  cwd: "/alias/project",
};
const path = "remote://voktty-ssh-fixture/alias/project/src";
const session = { session_id: 3, workspace_root: "/actual/project" };
let current: boolean;
const read = () =>
  readCapturedProjectIndex(path, project, profile, () => current);
function git(exitCode = 0) {
  return {
    stdout: btoa(exitCode ? "" : "file.ts\0"),
    stderr: "",
    exitCode,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  current = true;
  io.use.mockImplementation(async (_key, _connection, action) => {
    try {
      return await action(session);
    } finally {
      io.release();
    }
  });
  io.request.mockResolvedValue(git());
});

it("refuses a retired caller before acquiring any transport", async () => {
  current = false;
  await expect(read()).rejects.toThrow("retired");
  expect(io.use).not.toHaveBeenCalled();
});

it("does not issue Git after retirement during helper acquisition", async () => {
  let accept!: () => void;
  const use = io.use.getMockImplementation();
  io.use.mockImplementation(
    (...args) =>
      new Promise((resolve) => {
        accept = () => resolve(use?.(...args));
      }),
  );
  const pending = read();
  current = false;
  accept();
  await expect(pending).rejects.toThrow("retired");
  expect(io.request).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
});

it.each(["git", "ignore", "directory"])(
  "does not admit later traversal after retirement at %s",
  async (stage) => {
    io.request.mockImplementation(async (_id, method) => {
      if (method === "git.execWorkspace") {
        if (stage === "git") current = false;
        return git(128);
      }
      if (method === "fs.readFile") {
        if (stage === "ignore") {
          current = false;
          throw new Error("read failed");
        }
        return { content: "" };
      }
      if (method === "fs.readDir") {
        current = false;
        return { entries: [{ name: "nested", kind: "directory" }] };
      }
      throw new Error("Unexpected helper call");
    });
    await expect(read()).rejects.toThrow("retired");
    expect(io.request).toHaveBeenCalledTimes(
      stage === "git" ? 1 : stage === "ignore" ? 2 : 3,
    );
    expect(io.release).toHaveBeenCalledOnce();
  },
);

it("holds its lease through an already admitted retired request", async () => {
  let finish!: (value: unknown) => void;
  io.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = read();
  current = false;
  expect(io.release).not.toHaveBeenCalled();
  finish(git());
  await expect(pending).rejects.toThrow("retired");
  expect(io.release).toHaveBeenCalledOnce();
});

it("rechecks the owning continuation after lease release", async () => {
  io.release.mockImplementation(() => {
    current = false;
  });
  await expect(read()).rejects.toThrow("retired");
  expect(io.release).toHaveBeenCalledOnce();
});

it("does not disguise a retired request as an ordinary helper failure", async () => {
  let fail!: (error: Error) => void;
  io.request.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const pending = read();
  current = false;
  fail(new Error("network failed"));
  await expect(pending).rejects.toThrow("retired");
  expect(io.release).toHaveBeenCalledOnce();
});
