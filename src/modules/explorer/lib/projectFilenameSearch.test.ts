// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  canSearchFilenames,
  searchFilenames,
} from "@/modules/explorer/lib/filenameSearch";
import {
  captureProjectFilenameSearch,
  createProjectFilenameSearchStore,
} from "@/modules/explorer/lib/projectFilenameSearch";
import {
  rememberRemoteProject,
  forgetRemoteProject,
} from "@/modules/connections/model/remoteProjects";
import { RemoteRequestError } from "@/modules/remote/client";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  request: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
const path = "remote://voktty-ssh-fixture/srv/project/src";
const profile = { id: "fixture", name: "Fixture", host: "original.test" };
function lease(): RemoteSessionLease {
  return {
    info: {
      session_id: 7,
      workspace_root: "/canonical/project",
      architecture: "x86_64",
      helper_version: "1",
      capabilities: ["fs.searchNames"],
    },
    release: vi.fn(),
    releaseAndClose: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Fixture",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  io.acquire.mockResolvedValue(lease());
  io.request.mockResolvedValue({
    hits: [{ rel: "folder/file.ts", name: "file.ts", is_dir: false }],
    truncated: false,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  usePreferencesStore.setState({ sshConnections: [] });
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
});

it("searches a registered namespace through its own project lease and preserves the URI", async () => {
  const own = lease();
  io.acquire.mockResolvedValue(own);
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "unrelated" } });
  expect(canSearchFilenames({ kind: "local" }, path)).toBe(true);
  const result = await searchFilenames(
    { kind: "local" },
    path,
    "file",
    true,
    () => true,
  );
  expect(io.acquire).toHaveBeenCalledExactlyOnceWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "original.test" }),
  );
  expect(io.request).toHaveBeenCalledExactlyOnceWith(7, "fs.searchNames", {
    cwd: "src",
    query: "file",
    showHidden: true,
    maxResults: 200,
  });
  expect(result.hits[0].path).toBe(`${path}/folder/file.ts`);
  expect(own.release).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("preserves literal whitespace and newline directories in the project namespace", async () => {
  const root = "remote://voktty-ssh-fixture/srv/project/ \n";
  const result = await searchFilenames(
    { kind: "local" },
    root,
    "file",
    false,
    () => true,
  );
  expect(io.request).toHaveBeenCalledWith(
    7,
    "fs.searchNames",
    expect.objectContaining({ cwd: " \n" }),
  );
  expect(result.hits[0].path).toBe(`${root}/folder/file.ts`);
});

it("retires a pending acquisition before search and releases exactly its own lease", async () => {
  let finish!: (value: RemoteSessionLease) => void;
  io.acquire.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let active = true;
  const pending = searchFilenames(
    { kind: "local" },
    path,
    "file",
    false,
    () => active,
  );
  const rejected = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.acquire).toHaveBeenCalledOnce());
  active = false;
  const own = lease();
  finish(own);
  await rejected;
  expect(io.request).not.toHaveBeenCalled();
  expect(own.release).toHaveBeenCalledOnce();
});

it("retains a retired request lease until actual response settlement", async () => {
  const own = lease();
  io.acquire.mockResolvedValue(own);
  let finish!: (value: unknown) => void;
  io.request.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let active = true;
  const pending = searchFilenames(
    { kind: "local" },
    path,
    "file",
    false,
    () => active,
  );
  const rejected = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.request).toHaveBeenCalledOnce());
  active = false;
  expect(own.release).not.toHaveBeenCalled();
  finish({ hits: [], truncated: false });
  await rejected;
  expect(own.release).toHaveBeenCalledOnce();
});

it("never adopts an ambient SSH connection for an unknown saved profile", async () => {
  usePreferencesStore.setState({ sshConnections: [] });
  useWorkspaceEnvStore.setState({
    env: {
      kind: "ssh",
      root: "/srv/project",
      sessionId: 77,
      connection: profile,
    },
  });
  expect(canSearchFilenames({ kind: "local" }, path)).toBe(false);
  await expect(
    searchFilenames({ kind: "local" }, path, "file", false, () => true),
  ).rejects.toThrow();
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.request).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([
  "remote://unknown/srv/project",
  "remote://voktty-ssh-fixture/outside",
  "remote://voktty-ssh-fixture/srv/project/../src",
  "remote://voktty-ssh-fixture/srv/project/literal\\folder",
])("refuses unknown or ambiguous namespace %s", async (root) => {
  expect(canSearchFilenames({ kind: "local" }, root)).toBe(false);
  await expect(
    searchFilenames({ kind: "local" }, root, "file", false, () => true),
  ).rejects.toThrow();
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("releases its own lease on a legacy helper failure without local fallback", async () => {
  const own = lease();
  io.acquire.mockResolvedValue(own);
  io.request.mockRejectedValue(
    new RemoteRequestError("method_not_found", "old helper"),
  );
  await expect(
    searchFilenames({ kind: "local" }, path, "file", false, () => true),
  ).rejects.toThrow();
  expect(own.release).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("refuses unrepresentable namespace filenames instead of opening another POSIX path", async () => {
  io.request.mockResolvedValue({
    hits: [
      { rel: "literal\\file.ts", name: "literal\\file.ts", is_dir: false },
    ],
    truncated: false,
  });
  await expect(
    searchFilenames({ kind: "local" }, path, "file", false, () => true),
  ).rejects.toThrow("search hit");
});

it("retires every original receipt across a synchronous profile round trip", () => {
  const store = createProjectFilenameSearchStore(path);
  const changed = vi.fn();
  const stop = store.subscribe(changed);
  const original = store.getSnapshot();
  expect(original.source?.isCurrent()).toBe(true);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.test" }],
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  expect(original.source?.isCurrent()).toBe(false);
  expect(store.getSnapshot()).not.toBe(original);
  expect(store.getSnapshot().source?.isCurrent()).toBe(true);
  expect(changed).toHaveBeenCalledTimes(3);
  stop();
  expect(store.getSnapshot().source?.isCurrent()).toBe(false);
});

it("retires forgotten project receipts and never revives them after registration", () => {
  const store = createProjectFilenameSearchStore(path);
  const stop = store.subscribe(() => {});
  const original = store.getSnapshot();
  forgetRemoteProject("remote://voktty-ssh-fixture/srv/project");
  expect(original.source?.isCurrent()).toBe(false);
  expect(store.getSnapshot().source).toBeNull();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "replacement",
    name: "Fixture",
    cwd: "/srv/project",
  });
  expect(store.getSnapshot().source?.isCurrent()).toBe(true);
  expect(original.source?.isCurrent()).toBe(false);
  stop();
});

it("isolates duplicate subscribers and late cleanup from a replacement subscription", () => {
  const store = createProjectFilenameSearchStore(path);
  const listener = vi.fn();
  const first = store.subscribe(listener);
  const second = store.subscribe(listener);
  first();
  expect(store.getSnapshot().source?.isCurrent()).toBe(true);
  second();
  const retired = store.getSnapshot().source;
  const replacement = store.subscribe(listener);
  first();
  second();
  expect(retired?.isCurrent()).toBe(false);
  expect(store.getSnapshot().source?.isCurrent()).toBe(true);
  replacement();
});

it("copies a capture before reentrant lookup replacement and refuses its later authority", () => {
  const captured = captureProjectFilenameSearch(path);
  expect(captured).not.toBeNull();
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.test" }],
  });
  expect(captured?.isCurrent()).toBe(false);
  expect(io.acquire).not.toHaveBeenCalled();
});

it("retires failed setup and releases the preference subscription before a retry", () => {
  const subscribe = usePreferencesStore.subscribe;
  const releases: Array<ReturnType<typeof vi.fn>> = [];
  vi.spyOn(usePreferencesStore, "subscribe").mockImplementation((listener) => {
    const release = vi.fn(subscribe(listener));
    releases.push(release);
    return release;
  });
  const add = vi
    .spyOn(window, "addEventListener")
    .mockImplementationOnce(() => {
      throw new Error("registration failed");
    });
  const store = createProjectFilenameSearchStore(path);
  const old = store.getSnapshot().source;
  expect(() => store.subscribe(() => {})).toThrow("registration failed");
  expect(old?.isCurrent()).toBe(false);
  expect(releases[0]).toHaveBeenCalledOnce();
  add.mockRestore();
  const stop = store.subscribe(() => {});
  expect(store.getSnapshot().source?.isCurrent()).toBe(true);
  stop();
  expect(releases[1]).toHaveBeenCalledOnce();
});
