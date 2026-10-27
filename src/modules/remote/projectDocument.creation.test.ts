import { beforeEach, expect, it, vi } from "vitest";
import { createProjectDocument } from "@/modules/remote/projectDocument";
import { RemoteRequestError } from "@/modules/remote/client";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  stat: vi.fn(),
  request: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/filesystem", () => ({ remoteStat: io.stat }));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
const project = {
  key: "fixture",
  projectId: "fixture",
  environmentId: "voktty-ssh-fixture",
  cwd: "/srv/project",
};
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const path =
  "remote://voktty-ssh-fixture/srv/project/.agents/skills/review/SKILL.md";
function document() {
  return createProjectDocument(path, project, [profile]);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  for (const mock of Object.values(io)) mock.mockReset();
  io.acquire.mockResolvedValue({
    info: { session_id: 7, workspace_root: "/actual/project" },
    release: io.release,
  });
  io.stat.mockResolvedValue({ kind: "dir", size: 0, mtime: 0 });
  io.request.mockResolvedValue({});
});

it("creates and conditionally fills one exclusive file under its captured project lease", async () => {
  const mutableProject = { ...project },
    mutableProfile = { ...profile };
  const target = createProjectDocument(path, mutableProject, [mutableProfile]);
  mutableProject.cwd = "/replacement";
  mutableProfile.host = "replacement.invalid";
  await target.createText("instructions", () => true);
  expect(io.acquire).toHaveBeenCalledExactlyOnceWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "original.invalid" }),
  );
  expect(io.stat.mock.calls[0][1]).toBe("/actual/project/.agents");
  expect(io.request.mock.calls).toEqual([
    [7, "fs.createFile", { path: ".agents/skills/review/SKILL.md" }],
    [
      7,
      "fs.writeFile",
      {
        path: ".agents/skills/review/SKILL.md",
        content: "instructions",
        expectedContent: "",
      },
    ],
  ]);
  expect(io.release).toHaveBeenCalledOnce();
});

it("does not issue a write after its exclusive file creation retires", async () => {
  const allocation = deferred<unknown>();
  io.request.mockReturnValueOnce(allocation.promise);
  let current = true;
  const pending = document().createText("instructions", () => current);
  const result = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.request).toHaveBeenCalledOnce());
  current = false;
  expect(io.release).not.toHaveBeenCalled();
  allocation.resolve({});
  await result;
  expect(io.request).toHaveBeenCalledOnce();
  expect(io.release).toHaveBeenCalledOnce();
});

it("creates missing parents with guards between each directory", async () => {
  io.stat.mockRejectedValue(new RemoteRequestError("stat_failed", "missing"));
  await document().createText("instructions", () => true);
  expect(io.request.mock.calls.slice(0, 3)).toEqual([
    [7, "fs.createDir", { path: ".agents" }],
    [7, "fs.createDir", { path: ".agents/skills" }],
    [7, "fs.createDir", { path: ".agents/skills/review" }],
  ]);
});

it("refuses an existing skill without entering write", async () => {
  io.request.mockRejectedValueOnce(
    new RemoteRequestError("create_failed", "exists"),
  );
  await expect(
    document().createText("instructions", () => true),
  ).rejects.toThrow("exists");
  expect(io.request).toHaveBeenCalledOnce();
  expect(io.release).toHaveBeenCalledOnce();
});

it("does not create through a parent that is a file", async () => {
  io.stat.mockResolvedValueOnce({ kind: "file", size: 0, mtime: 0 });
  await expect(
    document().createText("instructions", () => true),
  ).rejects.toThrow("not a directory");
  expect(io.request).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
});

it("accepts a concurrent parent creation only after a fresh directory stat", async () => {
  io.stat.mockRejectedValueOnce(
    new RemoteRequestError("stat_failed", "missing"),
  );
  io.request.mockRejectedValueOnce(
    new RemoteRequestError("create_failed", "exists"),
  );
  await expect(
    document().createText("instructions", () => true),
  ).resolves.toBeUndefined();
  expect(io.stat.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([
    "/actual/project/.agents",
    "/actual/project/.agents",
  ]);
  expect(io.request).toHaveBeenLastCalledWith(
    7,
    "fs.writeFile",
    expect.objectContaining({ expectedContent: "" }),
  );
});

it("rejects oversized content before acquiring a native lease", async () => {
  await expect(
    document().createText("é".repeat(4 * 1024 * 1024 + 1), () => true),
  ).rejects.toThrow("Invalid");
  expect(io.acquire).not.toHaveBeenCalled();
});

it("rejects an excessive directory depth before acquiring a native lease", async () => {
  const target = createProjectDocument(
    `remote://voktty-ssh-fixture/srv/project/${"dir/".repeat(128)}SKILL.md`,
    project,
    [profile],
  );
  await expect(target.createText("instructions", () => true)).rejects.toThrow(
    "Invalid",
  );
  expect(io.acquire).not.toHaveBeenCalled();
});

it("does not enter another directory stage after a pending parent creation retires", async () => {
  io.stat.mockRejectedValueOnce(
    new RemoteRequestError("stat_failed", "missing"),
  );
  const directory = deferred<unknown>();
  io.request.mockReturnValueOnce(directory.promise);
  let current = true;
  const pending = document().createText("instructions", () => current);
  const result = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.request).toHaveBeenCalledOnce());
  current = false;
  directory.resolve({});
  await result;
  expect(io.request).toHaveBeenCalledExactlyOnceWith(7, "fs.createDir", {
    path: ".agents",
  });
  expect(io.release).toHaveBeenCalledOnce();
});
