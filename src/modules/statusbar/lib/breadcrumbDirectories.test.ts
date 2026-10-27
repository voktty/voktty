import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  readDir: vi.fn(),
  invoke: vi.fn(),
  profiles: [] as Array<{ id: string; name: string; host: string }>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: mocks.open,
  closeRemoteWorkspace: mocks.close,
}));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteReadDir: mocks.readDir,
  isPathInWorkspace: (env: { kind: string }, path: string) =>
    env.kind === "ssh" && !/^[A-Za-z]:[/\\]|^\\\\/.test(path),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ sshConnections: mocks.profiles }) },
}));
vi.mock("@/modules/connections/model/remoteSshProfiles", () => ({
  remoteSshEnvironmentId: (id: string) =>
    `voktty-ssh-${encodeURIComponent(id)}`,
  remoteSshConnectionForProfile: (profile: { host: string }) => ({
    host: profile.host,
    port: 22,
  }),
  findSshProfile: (
    namespace: string,
    profiles: typeof mocks.profiles = mocks.profiles,
  ) => {
    const id = namespace.startsWith("voktty-ssh-")
      ? decodeURIComponent(namespace.slice(11))
      : namespace;
    return profiles.find((profile) => profile.id === id);
  },
}));

import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  useHarnessProjectEnvStore,
  harnessProjectEnvironmentFor,
} from "@/modules/harness/lib/harnessEnvStore";
import {
  terminalRestoreWorkspace,
  terminalRestorePath,
} from "@/modules/tabs/lib/terminalProjectRestore";
import {
  breadcrumbRemoteReadRoot,
  readBreadcrumbDirectories,
} from "./breadcrumbDirectories";

const profile = { id: "p1", name: "one", host: "one.test" };
const uri = (path: string) => `remote://voktty-ssh-p1${path}`;
const info = (id: number, root = "/repo") => ({
  session_id: id,
  workspace_root: root,
  architecture: "x86_64",
  helper_version: "1",
  capabilities: [],
});
const workspace = {
  kind: "ssh" as const,
  connection: profile,
  root: "/repo",
  sessionId: 999,
};

beforeEach(async () => {
  await useHarnessProjectEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
  mocks.open.mockReset().mockResolvedValue(info(5));
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.readDir.mockReset().mockResolvedValue([
    { name: "src", kind: "dir" },
    { name: ".hidden", kind: "dir" },
    { name: "file", kind: "file" },
  ]);
  mocks.invoke.mockReset().mockResolvedValue([]);
  mocks.profiles = [profile];
});
afterEach(async () => {
  await useHarnessProjectEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
});

it.each([
  ["/repo/sub", "/repo", "/repo"],
  ["/repo/../outside", "/repo", "/"],
  ["/other", "/repo", "/"],
  ["C:\\Work\\Sub", "C:\\Work", "C:\\Work"],
  ["D:\\Other", "C:/Work", "D:/"],
  ["\\\\server\\share\\Other", "\\\\server\\share\\Repo", "//server/share"],
  [".", "/repo", "/repo"],
  ["src", "/repo", "/repo"],
])(
  "selects a bounded platform navigation root for %s",
  (path, root, expected) => {
    expect(breadcrumbRemoteReadRoot(path, root)).toBe(expected);
  },
);

it("adds a temporary lease to a live project and never borrows its supplied native ID", async () => {
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/repo");
  const projects = useHarnessProjectEnvStore.getState().projects;
  let finish!: (value: Array<{ name: string; kind: string }>) => void;
  mocks.readDir.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const reading = readBreadcrumbDirectories(uri("/repo/src"), workspace, false);
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  expect(remoteSessions.snapshot()[0].leases).toBe(2);
  expect(mocks.readDir).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 5, root: "/repo" }),
    uri("/repo/src"),
  );
  finish([{ name: "child", kind: "dir" }]);
  expect(await reading).toEqual(["child"]);
  expect(remoteSessions.snapshot()[0].leases).toBe(1);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(useHarnessProjectEnvStore.getState().projects).toEqual(projects);
  expect(
    harnessProjectEnvironmentFor(
      uri("/repo"),
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({
    root: "/repo",
    sessionId: 5,
  });
});

it("lists outside a project with a temporary root without resetting the project", async () => {
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/repo");
  mocks.open.mockResolvedValueOnce(info(6, "/"));
  expect(
    await readBreadcrumbDirectories(uri("/outside"), workspace, false),
  ).toEqual(["src"]);
  expect(mocks.open).toHaveBeenLastCalledWith(
    { host: "one.test", port: 22 },
    "/",
  );
  expect(mocks.close).toHaveBeenCalledWith(6);
  expect(mocks.close).not.toHaveBeenCalledWith(5);
  expect(
    harnessProjectEnvironmentFor(
      uri("/repo"),
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({
    root: "/repo",
    sessionId: 5,
  });
  expect(workspace).toMatchObject({ root: "/repo", sessionId: 999 });
});

it("releases its temporary helper even when the directory read rejects", async () => {
  mocks.readDir.mockRejectedValueOnce(new Error("denied"));
  await expect(
    readBreadcrumbDirectories(uri("/repo"), workspace, false),
  ).rejects.toThrow("denied");
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.close).toHaveBeenCalledWith(5);
  expect(
    harnessProjectEnvironmentFor(
      uri("/repo"),
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toEqual({ kind: "local" });
});

it("keeps the view's actual SSH configuration after a saved same-ID host changes", async () => {
  mocks.profiles = [{ ...profile, host: "new.test" }];
  await readBreadcrumbDirectories(uri("/repo"), workspace, false);
  expect(mocks.open).toHaveBeenCalledWith(
    { host: "one.test", port: 22 },
    "/repo",
  );
});

it.each([uri("/repo"), "/repo", "C:/Work", "//server/share/app"])(
  "resolves a restored descriptor for breadcrumb path %s without local fallback",
  async (path) => {
    const pending = terminalRestoreWorkspace(uri("/repo"));
    await readBreadcrumbDirectories(path, pending, false);
    expect(mocks.open).toHaveBeenCalledWith(
      { host: "one.test", port: 22 },
      expect.any(String),
    );
    expect(mocks.readDir).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 5 }),
      terminalRestorePath(uri("/repo"), path),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  },
);

it("reports an unavailable restored breadcrumb profile without using native directories", async () => {
  mocks.profiles = [];
  await expect(
    readBreadcrumbDirectories(
      "/repo",
      terminalRestoreWorkspace(uri("/repo")),
      false,
    ),
  ).rejects.toThrow("missing");
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it("does not borrow a selected unrelated project or ownerless environment", async () => {
  await useHarnessProjectEnvStore
    .getState()
    .connect({ ...profile, id: "p2", host: "two.test" } as never, "/repo");
  mocks.open.mockResolvedValueOnce(info(6, "/"));
  await readBreadcrumbDirectories(uri("/repo"), undefined, true);
  expect(mocks.open).toHaveBeenLastCalledWith(
    { host: "one.test", port: 22 },
    "/",
  );
  expect(mocks.readDir).toHaveBeenLastCalledWith(
    expect.objectContaining({ sessionId: 6 }),
    uri("/repo"),
  );
  expect(
    harnessProjectEnvironmentFor(
      "remote://voktty-ssh-p2/repo",
      useHarnessProjectEnvStore.getState().projects,
    ).env,
  ).toMatchObject({
    connection: { id: "p2" },
  });
});

it("reads only the exact owned unsaved project configuration", async () => {
  mocks.profiles = [];
  await useHarnessProjectEnvStore.getState().connect(profile as never, "/repo");
  await readBreadcrumbDirectories(uri("/repo"), undefined, false);
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(mocks.close).not.toHaveBeenCalled();
  await expect(
    readBreadcrumbDirectories(uri("/unowned"), undefined, false),
  ).rejects.toThrow("missing");
});

it("does not infer SSH or use local FS for an unknown remote namespace", async () => {
  await expect(
    readBreadcrumbDirectories("remote://unknown/repo", undefined, false),
  ).rejects.toThrow("missing");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("filters hidden folders without altering the backend permission context", async () => {
  expect(
    await readBreadcrumbDirectories(uri("/repo"), workspace, true),
  ).toEqual(["src", ".hidden"]);
});

it("keeps local and WSL native filesystem routing", async () => {
  await readBreadcrumbDirectories("C:/Work", workspace, false);
  expect(mocks.invoke).toHaveBeenLastCalledWith("list_subdirs", {
    path: "C:/Work",
    showHidden: false,
    workspace: { kind: "local" },
  });
  await readBreadcrumbDirectories(
    "/work",
    { kind: "wsl", distro: "Ubuntu" },
    true,
  );
  expect(mocks.invoke).toHaveBeenLastCalledWith("list_subdirs", {
    path: "/work",
    showHidden: true,
    workspace: { kind: "wsl", distro: "Ubuntu" },
  });
});

it("retains Docker's typed native FS bridge", async () => {
  mocks.invoke.mockResolvedValueOnce([
    { name: "src", kind: "dir" },
    { name: "file", kind: "file" },
  ]);
  const docker = {
    kind: "docker" as const,
    connection: { containerId: "c1", containerName: "one", image: "test" },
  };
  expect(await readBreadcrumbDirectories("/work", docker, false)).toEqual([
    "src",
  ]);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "fs_read_dir",
    expect.objectContaining({
      path: "/work",
      workspace: expect.objectContaining({ kind: "docker", containerId: "c1" }),
    }),
  );
});
