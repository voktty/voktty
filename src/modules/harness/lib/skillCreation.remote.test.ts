// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBlankSkill } from "@/modules/harness/lib/skills";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  request: vi.fn(),
  stat: vi.fn(),
  createLocal: vi.fn(),
  writeLocal: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  createPath: io.createLocal,
  writeTextFile: io.writeLocal,
  homeDir: async () => "/home/fixture",
  listSkills: vi.fn(),
  readTextFile: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/filesystem", () => ({ remoteStat: io.stat }));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
const cwd = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const lease = () => ({
  info: { session_id: 7, workspace_root: "/actual/project" },
  release: io.release,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  for (const mock of Object.values(io)) mock.mockReset();
  io.acquire.mockResolvedValue(lease());
  io.stat.mockResolvedValue({ kind: "dir", size: 0, mtime: 0 });
  io.request.mockResolvedValue({});
  io.createLocal.mockResolvedValue(
    "/home/fixture/.agents/skills/review/SKILL.md",
  );
  io.writeLocal.mockResolvedValue(undefined);
});
afterEach(() => {
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("creates a saved SSH project skill through one captured helper without local IO", async () => {
  const complete = vi.fn();
  await expect(
    createBlankSkill(
      { cwd, name: "review", scope: "project" },
      () => {},
      complete,
    ),
  ).resolves.toBe(`${cwd}/.agents/skills/review/SKILL.md`);
  expect(io.acquire).toHaveBeenCalledExactlyOnceWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "original.invalid" }),
  );
  expect(io.request.mock.calls.map((call) => call[1])).toEqual([
    "fs.createFile",
    "fs.writeFile",
  ]);
  expect(io.request).toHaveBeenLastCalledWith(
    7,
    "fs.writeFile",
    expect.objectContaining({
      path: ".agents/skills/review/SKILL.md",
      expectedContent: "",
    }),
  );
  expect(io.createLocal).not.toHaveBeenCalled();
  expect(io.writeLocal).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledOnce();
});

it.each(["replace", "roundtrip"] as const)(
  "retires a captured remote allocation after profile %s",
  async (change) => {
    const allocation = deferred<unknown>();
    io.request.mockReturnValueOnce(allocation.promise);
    const complete = vi.fn();
    const pending = createBlankSkill(
      { cwd, name: "review", scope: "project" },
      () => {},
      complete,
    );
    const result = expect(pending).rejects.toThrow("project changed");
    await vi.waitFor(() => expect(io.request).toHaveBeenCalledOnce());
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "replacement.invalid" }],
    });
    if (change === "roundtrip")
      usePreferencesStore.setState({ sshConnections: [profile] });
    expect(io.release).not.toHaveBeenCalled();
    allocation.resolve({});
    await result;
    expect(io.request).toHaveBeenCalledOnce();
    expect(io.release).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  },
);

it("releases only the late original helper lease when its profile changes during acquisition", async () => {
  const acquisition = deferred<ReturnType<typeof lease>>();
  io.acquire.mockReturnValueOnce(acquisition.promise);
  const pending = createBlankSkill({ cwd, name: "review", scope: "project" });
  const result = expect(pending).rejects.toThrow("project changed");
  await vi.waitFor(() => expect(io.acquire).toHaveBeenCalledOnce());
  usePreferencesStore.setState({ sshConnections: [] });
  acquisition.resolve(lease());
  await result;
  expect(io.request).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
  expect(io.createLocal).not.toHaveBeenCalled();
});

it("refuses an unavailable project source without local allocation", async () => {
  usePreferencesStore.setState({ sshConnections: [] });
  await expect(
    createBlankSkill({ cwd, name: "review", scope: "project" }),
  ).rejects.toThrow("unavailable");
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.createLocal).not.toHaveBeenCalled();
});

it("keeps personal skills native even when the selected SSH profile is unavailable", async () => {
  usePreferencesStore.setState({ sshConnections: [] });
  await expect(
    createBlankSkill({ cwd, name: "review", scope: "user" }),
  ).resolves.toBe("/home/fixture/.agents/skills/review/SKILL.md");
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.createLocal).toHaveBeenCalledExactlyOnceWith(
    "/home/fixture",
    ".agents/skills/review/SKILL.md",
    false,
  );
});
