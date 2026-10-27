// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  loadProjectFiles,
  peekProjectFiles,
  invalidateProjectFiles,
  resolveOpenablePath,
  subscribeProjectFiles,
} from "@/modules/harness/lib/fileIndex";
import type { ProjectFile } from "@/modules/harness/lib/fs";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";

const io = vi.hoisted(() => ({ list: vi.fn(), local: vi.fn() }));
vi.mock("@/modules/harness/lib/fs", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/fs")>()),
  listProjectFiles: io.local,
}));
vi.mock("@/modules/connections/model/remoteCommands", () => ({
  readCapturedProjectIndex: io.list,
}));
const root = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const files: ProjectFile[] = [
  { name: "original.ts", relative: "original.ts", path: `${root}/original.ts` },
];
beforeEach(() => {
  invalidateProjectFiles();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  io.list.mockReset().mockResolvedValue(files);
  io.local.mockReset().mockResolvedValue(files);
});
afterEach(() => {
  invalidateProjectFiles();
  localStorage.clear();
  usePreferencesStore.setState({ sshConnections: [] });
  vi.restoreAllMocks();
});

it.each(["profile", "roundtrip", "missing", "project"])(
  "withdraws cached names after %s replacement",
  async (mode) => {
    await loadProjectFiles(root);
    if (mode === "project")
      rememberRemoteProject("voktty-ssh-fixture", {
        id: "replacement",
        name: "Project",
        cwd: "/srv/project",
      });
    else {
      usePreferencesStore.setState({
        sshConnections:
          mode === "missing"
            ? []
            : [{ ...profile, host: "replacement.invalid" }],
      });
      if (mode === "roundtrip")
        usePreferencesStore.setState({ sshConnections: [profile] });
    }
    expect(peekProjectFiles(root)).toBeNull();
  },
);

it("does not deliver or cache a retired pending index", async () => {
  let finish!: (value: ProjectFile[]) => void;
  io.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const scan = loadProjectFiles(root);
  const rejected = expect(scan).rejects.toThrow("retired");
  await vi.dynamicImportSettled();
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  finish(files);
  await rejected;
  expect(peekProjectFiles(root)).toBeNull();
});

it("does not start a successor reader after retirement during lazy loading", async () => {
  const pending = loadProjectFiles(root);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  await expect(pending).rejects.toThrow("retired");
  expect(io.list).not.toHaveBeenCalled();
  expect(io.local).not.toHaveBeenCalled();
});

it("rechecks retirement after a reentrant result notification", async () => {
  let changed = false;
  const stop = subscribeProjectFiles(() => {
    if (changed) return;
    changed = true;
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "replacement.invalid" }],
    });
  });
  try {
    await expect(loadProjectFiles(root)).rejects.toThrow("retired");
    expect(peekProjectFiles(root)).toBeNull();
  } finally {
    stop();
  }
});

it("keeps a successor cached when the original physical read finally settles", async () => {
  let finish!: (value: ProjectFile[]) => void;
  io.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const original = loadProjectFiles(root);
  const retired = expect(original).rejects.toThrow("retired");
  await vi.dynamicImportSettled();
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  const next = [
    { name: "current.ts", relative: "current.ts", path: `${root}/current.ts` },
  ];
  io.list.mockResolvedValue(next);
  expect(await loadProjectFiles(root)).toEqual(next);
  finish(files);
  await retired;
  expect(peekProjectFiles(root)).toEqual(next);
  expect(io.list.mock.calls.map(([, , connection]) => connection.host)).toEqual(
    ["original.invalid", "replacement.invalid"],
  );
});

it("publishes its pending promise before a reentrant reader", async () => {
  let joined: Promise<ProjectFile[]> | undefined;
  io.list.mockImplementationOnce(() => {
    joined = loadProjectFiles(root);
    return Promise.resolve(files);
  });
  const original = loadProjectFiles(root);
  await expect(original).resolves.toEqual(files);
  expect(joined).toBe(original);
  expect(io.list).toHaveBeenCalledOnce();
});

it("publishes its reservation before a reentrant metadata subscription", async () => {
  const subscribe = usePreferencesStore.subscribe;
  let joined: Promise<ProjectFile[]> | undefined;
  vi.spyOn(usePreferencesStore, "subscribe").mockImplementation((listener) => {
    const stop = subscribe(listener);
    joined = loadProjectFiles(root);
    return stop;
  });
  const original = loadProjectFiles(root);
  await expect(original).resolves.toEqual(files);
  expect(joined).toBe(original);
  expect(io.list).toHaveBeenCalledOnce();
});

it("collects a failed observer setup before retrying", async () => {
  const add = vi
    .spyOn(window, "addEventListener")
    .mockImplementationOnce(() => {
      throw new Error("setup failed");
    });
  await expect(loadProjectFiles(root)).rejects.toThrow("setup failed");
  expect(io.list).not.toHaveBeenCalled();
  add.mockRestore();
  await expect(loadProjectFiles(root)).resolves.toEqual(files);
});

it("does not adopt a binding changed reentrantly during observer setup", async () => {
  const subscribe = usePreferencesStore.subscribe;
  vi.spyOn(usePreferencesStore, "subscribe").mockImplementationOnce(
    (listener) => {
      usePreferencesStore.setState({
        sshConnections: [{ ...profile, host: "replacement.invalid" }],
      });
      return subscribe(listener);
    },
  );
  await expect(loadProjectFiles(root)).rejects.toThrow("retired");
  expect(io.list).not.toHaveBeenCalled();
  await expect(loadProjectFiles(root)).resolves.toEqual(files);
  expect(io.list).toHaveBeenCalledWith(
    root,
    expect.anything(),
    expect.objectContaining({ host: "replacement.invalid" }),
    expect.any(Function),
  );
});

it("releases observers only when their cached scope is evicted or invalidated", async () => {
  const subscribe = usePreferencesStore.subscribe;
  const releases: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(usePreferencesStore, "subscribe").mockImplementation((listener) => {
    const stop = vi.fn(subscribe(listener));
    releases.push(stop);
    return stop;
  });
  for (let i = 0; i < 9; i++) await loadProjectFiles(`${root}/tree-${i}`);
  expect(releases).toHaveLength(9);
  expect(releases[0]).toHaveBeenCalledOnce();
  expect(releases.slice(1).every((stop) => stop.mock.calls.length === 0)).toBe(
    true,
  );
  invalidateProjectFiles();
  expect(releases.every((stop) => stop.mock.calls.length === 1)).toBe(true);
});

it("holds scan capacity through retired physical reads and restores it only after settlement", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const finish: Array<(value: ProjectFile[]) => void> = [];
  io.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      }),
  );
  const reads = Array.from({ length: 256 }, () => loadProjectFiles(root, true));
  const settled = Promise.allSettled(reads);
  await vi.dynamicImportSettled();
  expect(finish).toHaveLength(256);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  await expect(loadProjectFiles(root)).rejects.toThrow("capacity");
  for (const resolve of finish) resolve(files);
  expect((await settled).every((result) => result.status === "rejected")).toBe(
    true,
  );
  io.list.mockResolvedValue(files);
  await expect(loadProjectFiles(root)).resolves.toEqual(files);
});

it("does not turn a retired index into a direct-path fallback", async () => {
  let finish!: (value: ProjectFile[]) => void;
  io.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = resolveOpenablePath(root, "file.ts");
  const rejected = expect(pending).rejects.toThrow("retired");
  await vi.dynamicImportSettled();
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  finish(files);
  await rejected;
});

it("does not treat a retired read failure as optional direct-path recovery", async () => {
  let fail!: (error: Error) => void;
  io.list.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const pending = resolveOpenablePath(root, "file.ts");
  const rejected = expect(pending).rejects.toThrow("retired");
  await vi.dynamicImportSettled();
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  fail(new Error("network failed"));
  await rejected;
});

it("bounds retained scopes across cached and physically pending folders", async () => {
  for (let i = 0; i < 8; i++) await loadProjectFiles(`${root}/cached-${i}`);
  const finish: Array<(value: ProjectFile[]) => void> = [];
  io.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      }),
  );
  const pending = Array.from({ length: 248 }, (_, i) =>
    loadProjectFiles(`${root}/pending-${i}`),
  );
  const settled = Promise.all(pending);
  await vi.dynamicImportSettled();
  await expect(loadProjectFiles(`${root}/overflow`)).rejects.toThrow(
    "capacity",
  );
  expect(finish).toHaveLength(248);
  for (const resolve of finish) resolve(files);
  await settled;
  io.list.mockResolvedValue(files);
  await expect(loadProjectFiles(`${root}/after-settlement`)).resolves.toEqual(
    files,
  );
});

it.each(["/native-project", "remote://legacy-host/srv/project"])(
  "preserves %s without observing saved SSH profiles",
  async (cwd) => {
    const subscribe = vi.spyOn(usePreferencesStore, "subscribe");
    await expect(loadProjectFiles(cwd)).resolves.toEqual(files);
    expect(io.local).toHaveBeenCalledWith(cwd);
    expect(subscribe).not.toHaveBeenCalled();
    expect(io.list).not.toHaveBeenCalled();
  },
);
