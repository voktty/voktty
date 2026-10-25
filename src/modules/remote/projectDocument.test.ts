import { beforeEach, expect, it, vi } from "vitest";
import { createProjectDocument } from "@/modules/remote/projectDocument";
import type { SshConnection } from "@/modules/ssh/types";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteReadDocument: io.read,
  remoteStat: io.stat,
  remoteRelativePath: (_: unknown, path: string) =>
    path.slice("/srv/project/".length),
}));
vi.mock("@/modules/remote/client", () => ({ requestRemoteResult: io.request }));
const profile: SshConnection = {
  id: "fixture",
  name: "Fixture",
  host: "host-a",
  identityFile: "/keys/fixture",
};
const project = {
  key: "project",
  projectId: "project",
  environmentId: "voktty-ssh-fixture",
  cwd: "/srv/project",
};
const path = "remote://voktty-ssh-fixture/srv/project/file.txt";
const current = () => true;
function lease(): RemoteSessionLease {
  return {
    info: {
      session_id: 7,
      workspace_root: "/srv/project",
      architecture: "x86_64",
      helper_version: "1",
      capabilities: [],
    },
    release: vi.fn(),
    releaseAndClose: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  io.acquire.mockResolvedValue(lease());
  io.read.mockResolvedValue({
    kind: "text",
    content: "original",
    size: 8,
    mtime: 10,
  });
  io.stat.mockResolvedValue({ kind: "file", size: 8, mtime: 11 });
  io.request.mockResolvedValue({});
});

it("captures the saved project and SSH binding before acquiring its own lease", async () => {
  const mutable = { ...profile };
  const root = { ...project };
  const document = createProjectDocument(path, root, [mutable]);
  mutable.host = "host-b";
  root.cwd = "/other";
  const own = lease();
  io.acquire.mockResolvedValue(own);
  expect(await document.read(false, current)).toEqual({
    kind: "text",
    content: "original",
    size: 8,
    mtime: 10,
  });
  expect(io.acquire).toHaveBeenCalledWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "host-a" }),
  );
  expect(io.read).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 7, root: "/srv/project" }),
    "/srv/project/file.txt",
    false,
  );
  expect(own.release).toHaveBeenCalledOnce();
});

it.each([
  ["remote://missing/srv/project/file.txt", project, [profile]],
  [path, undefined, [profile]],
  ["remote://voktty-ssh-fixture/outside/file.txt", project, [profile]],
  [path, project, []],
] as const)(
  "rejects an unowned namespace without acquiring a native session",
  (target, root, profiles) => {
    expect(() => createProjectDocument(target, root, [...profiles])).toThrow();
    expect(io.acquire).not.toHaveBeenCalled();
  },
);

it("retires a pending acquisition before writing and releases only its own lease", async () => {
  let resolve!: (value: RemoteSessionLease) => void;
  io.acquire.mockReturnValue(
    new Promise<RemoteSessionLease>((yes) => {
      resolve = yes;
    }),
  );
  let active = true;
  const own = lease();
  const write = createProjectDocument(path, project, [profile]).write(
    "edited",
    () => active,
  );
  const rejected = expect(write).rejects.toThrow("retired");
  active = false;
  resolve(own);
  await rejected;
  expect(io.request).not.toHaveBeenCalled();
  expect(own.release).toHaveBeenCalledOnce();
});

it("sends conditional writes to the helper with a project-relative path", async () => {
  expect(
    await createProjectDocument(path, project, [profile]).write(
      "edited",
      current,
      "original",
    ),
  ).toBe(11);
  expect(io.request).toHaveBeenCalledWith(7, "fs.writeFile", {
    path: "file.txt",
    content: "edited",
    expectedContent: "original",
  });
});

it("does not enter a later stat after an accepted write retires", async () => {
  let resolve!: (value: object) => void;
  io.request.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  let active = true;
  const own = lease();
  io.acquire.mockResolvedValue(own);
  const write = createProjectDocument(path, project, [profile]).write(
    "edited",
    () => active,
  );
  const rejected = expect(write).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.request).toHaveBeenCalledOnce());
  active = false;
  resolve({});
  await rejected;
  expect(io.stat).not.toHaveBeenCalled();
  expect(own.release).toHaveBeenCalledOnce();
});

it("retains capacity for retired acquisitions until actual settlement", async () => {
  const resolve: Array<(value: RemoteSessionLease) => void> = [];
  io.acquire.mockImplementation(
    () => new Promise<RemoteSessionLease>((yes) => resolve.push(yes)),
  );
  let active = true;
  const document = createProjectDocument(path, project, [profile]);
  const cohort = Promise.allSettled(
    Array.from({ length: 256 }, () => document.stat(() => active)),
  );
  active = false;
  await expect(document.stat(current)).rejects.toThrow("capacity");
  const leases = resolve.map(() => lease());
  resolve.forEach((yes, index) => {
    yes(leases[index]);
  });
  expect((await cohort).every((result) => result.status === "rejected")).toBe(
    true,
  );
  expect(io.stat).not.toHaveBeenCalled();
  expect(
    leases.every((own) => vi.mocked(own.release).mock.calls.length === 1),
  ).toBe(true);
  io.acquire.mockResolvedValue(lease());
  await expect(document.stat(current)).resolves.toMatchObject({ mtime: 11 });
});
