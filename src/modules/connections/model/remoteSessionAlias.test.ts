// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runRemoteCommand } from "@/modules/connections/model/remoteCommands";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  use: vi.fn(),
  request: vi.fn(),
  native: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { use: io.use },
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.native }));

const root = "remote://voktty-ssh-session-alias/alias/project";
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-session-alias", {
    id: "project",
    name: "Project",
    cwd: "/alias/project",
  });
  usePreferencesStore.setState({
    sshConnections: [
      { id: "session-alias", name: "Host", host: "host.invalid" },
    ],
  });
  io.use.mockImplementation(async (_key, _connection, action) =>
    action({
      session_id: 17,
      workspace_root: "/actual/project",
      capabilities: [],
    }),
  );
  io.request.mockImplementation(async (_id, method, params) => {
    if (method === "fs.readDir")
      return { entries: [{ name: "one.json", kind: "file" }] };
    if (method === "fs.readFile") return { content: "session content" };
    if (method === "fs.stat") return { kind: "dir", size: 0, mtime: 1 };
    if (method === "fs.createDir")
      return { path: `/actual/project/${params.path}` };
    if (method === "fs.writeFile") return {};
    throw new Error("Unexpected request");
  });
});
afterEach(() => {
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("keeps Harness session storage inside its leased helper and returns the saved alias", async () => {
  const directory = `${root}/.voktty/sessions`;
  await expect(
    runRemoteCommand("list_dir", { path: directory }),
  ).resolves.toEqual([
    {
      name: "one.json",
      path: `${directory}/one.json`,
      isDir: false,
      ignored: false,
    },
  ]);
  await expect(
    runRemoteCommand("read_text_file", { path: `${directory}/one.json` }),
  ).resolves.toBe("session content");
  await runRemoteCommand("write_text_file", {
    path: `${directory}/one.json`,
    content: "updated",
  });
  await runRemoteCommand("stat_files", { paths: [directory] });
  await expect(
    runRemoteCommand("create_path", {
      parent: `${root}/.voktty`,
      name: "sessions",
      isDir: true,
    }),
  ).resolves.toBe(directory);
  expect(io.use).toHaveBeenCalledWith(
    { profileId: "session-alias", root: "/alias/project" },
    expect.objectContaining({ host: "host.invalid" }),
    expect.any(Function),
  );
  expect(io.request).toHaveBeenCalledWith(17, "fs.readDir", {
    path: ".voktty/sessions",
  });
  expect(io.request).toHaveBeenCalledWith(17, "fs.readFile", {
    path: ".voktty/sessions/one.json",
  });
  expect(io.request).toHaveBeenCalledWith(17, "fs.writeFile", {
    path: ".voktty/sessions/one.json",
    content: "updated",
  });
  expect(io.request).toHaveBeenCalledWith(17, "fs.stat", {
    path: ".voktty/sessions",
  });
  expect(io.native).not.toHaveBeenCalled();
});

it("rejects foreign namespace paths before acquiring a helper", async () => {
  await expect(
    runRemoteCommand("stat_files", {
      paths: [`${root}/.voktty`, "remote://voktty-ssh-session-alias/foreign"],
    }),
  ).rejects.toThrow();
  expect(io.use).not.toHaveBeenCalled();
  expect(io.request).not.toHaveBeenCalled();
});

it("rejects a helper result outside its accepted canonical root", async () => {
  io.request.mockResolvedValue({ path: "/foreign/sessions" });
  await expect(
    runRemoteCommand("create_path", {
      parent: root,
      name: "sessions",
      isDir: true,
    }),
  ).rejects.toThrow("cannot leave their saved project root");
});
