// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useSourceControl,
  loadSharedSourceControlSnapshot,
} from "@/modules/source-control/useSourceControl";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  status: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  publish: vi.fn(),
  undo: vi.fn(),
  init: vi.fn(),
  authorize: vi.fn(),
  safe: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitResolveRepo: mocks.resolve,
    gitStatus: mocks.status,
    gitFetch: mocks.fetch,
    gitPullFfOnly: mocks.pull,
    gitPush: mocks.push,
    gitPublish: mocks.publish,
    gitUndoCommit: mocks.undo,
    gitInit: mocks.init,
    workspaceAuthorize: mocks.authorize,
    gitAddSafeDirectory: mocks.safe,
  },
}));
vi.mock("@/modules/explorer/lib/watch", () => ({
  isPathWithinTree: () => false,
  listenFsChanged: async () => () => {},
  watchAddTree: () => {},
  watchRemoveTree: () => {},
}));
let root: Root;
let output: ReturnType<typeof useSourceControl>;
let folder: string;
let counter = 0;
let idle: (() => void)[];
const previousWorkspace = useWorkspaceEnvStore.getState().env;
const previousIdle = Object.getOwnPropertyDescriptor(
  window,
  "requestIdleCallback",
);
const previousCancel = Object.getOwnPropertyDescriptor(
  window,
  "cancelIdleCallback",
);
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/",
  sessionId: 7,
  connection: { id: "build", name: "Build", host: "build.example" },
};
function snapshot(branch = "local"): GitStatusSnapshot {
  return {
    repoRoot: folder,
    branch,
    upstream: "origin/main",
    ahead: 0,
    behind: 1,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  };
}
function Probe({ path }: { path: string }) {
  output = useSourceControl(path, true, false);
  return null;
}
async function render(path = folder) {
  await act(async () => root.render(<Probe path={path} />));
}
async function flushIdle() {
  await act(async () => {
    const queued = idle.splice(0);
    for (const run of queued) run();
  });
}
async function select(workspace: WorkspaceEnv) {
  await act(async () => useWorkspaceEnvStore.setState({ env: workspace }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  folder = `/repository-scope-${++counter}`;
  idle = [];
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    value: (run: () => void) => {
      idle.push(run);
      return idle.length;
    },
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    value: () => {},
  });
  for (const mock of Object.values(mocks))
    mock.mockReset().mockResolvedValue(undefined);
  mocks.resolve.mockImplementation(async () => ({
    repoRoot: folder,
    branch: "main",
    upstream: "origin/main",
    isDetached: false,
  }));
  mocks.status.mockImplementation(
    async (_path: string, workspace: WorkspaceEnv) =>
      snapshot(
        workspace.kind === "ssh" ? workspace.connection.host : workspace.kind,
      ),
  );
  useWorkspaceEnvStore.setState({ env: ssh });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceEnvStore.setState({ env: previousWorkspace });
  if (previousIdle)
    Object.defineProperty(window, "requestIdleCallback", previousIdle);
  else Reflect.deleteProperty(window, "requestIdleCallback");
  if (previousCancel)
    Object.defineProperty(window, "cancelIdleCallback", previousCancel);
  else Reflect.deleteProperty(window, "cancelIdleCallback");
  vi.unstubAllGlobals();
});
it("hides an SSH snapshot immediately when the same POSIX path becomes local", async () => {
  await render();
  await flushIdle();
  expect(output.status?.branch).toBe("build.example");
  await select(LOCAL_WORKSPACE);
  expect(output.status).toBeNull();
  expect(output.repo).toBeNull();
  expect(output.hasRepo).toBe(false);
  await flushIdle();
  expect(output.status?.branch).toBe("local");
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
  expect(mocks.status).toHaveBeenLastCalledWith(folder, LOCAL_WORKSPACE);
});
it.each(["host", "identity", "session"])(
  "does not reuse a snapshot for a changed SSH %s with the same profile and root",
  async (change) => {
    await render();
    await flushIdle();
    if (ssh.kind !== "ssh") throw new Error("Expected SSH fixture");
    const next = {
      ...ssh,
      sessionId: change === "session" ? 8 : 7,
      connection: {
        ...ssh.connection,
        host: change === "host" ? "other.example" : ssh.connection.host,
        identityFile: change === "identity" ? "/keys/other" : undefined,
      },
    };
    await select(next);
    expect(output.status).toBeNull();
    await flushIdle();
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
    expect(mocks.status).toHaveBeenLastCalledWith(folder, next);
  },
);
it("keeps the same-filesystem within-repository TTL reuse", async () => {
  await render();
  await flushIdle();
  const first = output.status;
  await render(`${folder}/nested`);
  await flushIdle();
  expect(output.status).toBe(first);
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.status).toHaveBeenCalledTimes(1);
});
it("refuses captured mutation callbacks after a context change and return", async () => {
  await render();
  await flushIdle();
  const old = output;
  await select(LOCAL_WORKSPACE);
  await flushIdle();
  await select(ssh);
  await flushIdle();
  const mutate = vi.fn((value: GitStatusSnapshot) => ({
    ...value,
    branch: "stale",
  }));
  await act(async () => {
    old.applyStatus(mutate);
    await old.undoCommit();
    await old.runRemoteAction("push");
    await old.initRepository();
    await old.trustRepository();
    await old.refresh();
  });
  expect(mutate).not.toHaveBeenCalled();
  for (const mock of [
    mocks.undo,
    mocks.push,
    mocks.init,
    mocks.safe,
    mocks.authorize,
  ])
    expect(mock).not.toHaveBeenCalled();
  expect(output.status?.branch).toBe("build.example");
});
it("does not admit a new action using the previous filesystem's repository", async () => {
  await render();
  await flushIdle();
  await select(LOCAL_WORKSPACE);
  await act(async () => output.undoCommit());
  expect(mocks.undo).not.toHaveBeenCalled();
});
it("does not pull after an admitted fetch settles under a retired context", async () => {
  await render();
  await flushIdle();
  const pending = deferred<void>();
  mocks.fetch.mockReturnValue(pending.promise);
  let operation!: ReturnType<typeof output.runRemoteAction>;
  await act(async () => {
    operation = output.runRemoteAction("pull");
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await select(LOCAL_WORKSPACE);
  await flushIdle();
  await act(async () => {
    pending.resolve();
    await operation;
  });
  expect(mocks.pull).not.toHaveBeenCalled();
  expect(output.status?.branch).toBe("local");
});
it("does not authorize a remote POSIX trust path on this computer", async () => {
  await render();
  await flushIdle();
  await act(async () => output.trustRepository());
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.safe).toHaveBeenCalledWith(folder, ssh);
});
it("stops local trust after its authorization returns to a retired caller", async () => {
  await select(LOCAL_WORKSPACE);
  await render();
  await flushIdle();
  const pending = deferred<void>();
  mocks.authorize.mockReturnValue(pending.promise);
  let operation!: ReturnType<typeof output.trustRepository>;
  await act(async () => {
    operation = output.trustRepository();
  });
  await select(ssh);
  await flushIdle();
  await act(async () => {
    pending.resolve();
    await operation;
  });
  expect(mocks.safe).not.toHaveBeenCalled();
});

it("retires callbacks through a batched change away and back", async () => {
  await render();
  await flushIdle();
  const old = output;
  await act(async () => {
    useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
    useWorkspaceEnvStore.setState({ env: ssh });
  });
  await act(async () => old.undoCommit());
  expect(mocks.undo).not.toHaveBeenCalled();
});

it("rejects an old callback even before its workspace subscriber runs", async () => {
  let old: typeof output | undefined;
  const stop = useWorkspaceEnvStore.subscribe(() => {
    if (old) void old.undoCommit();
  });
  try {
    await render();
    await flushIdle();
    old = output;
    await select(LOCAL_WORKSPACE);
    expect(mocks.undo).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("does not publish an old SSH status over the current local snapshot", async () => {
  const pending = deferred<GitStatusSnapshot>();
  mocks.status.mockReturnValueOnce(pending.promise);
  await render();
  await flushIdle();
  await select(LOCAL_WORKSPACE);
  await flushIdle();
  expect(output.status?.branch).toBe("local");
  await act(async () => pending.resolve(snapshot("retired SSH")));
  expect(output.status?.branch).toBe("local");
});

it("does not start an automatic fetch after repository resolution retires", async () => {
  const pending = deferred<{
    repoRoot: string;
    branch: string;
    upstream: string;
    isDetached: boolean;
  }>();
  mocks.resolve.mockReturnValueOnce(pending.promise);
  await render();
  let operation!: Promise<void>;
  await act(async () => {
    operation = output.refresh({ remote: "always" });
  });
  await select(LOCAL_WORKSPACE);
  await flushIdle();
  await act(async () => {
    pending.resolve({
      repoRoot: folder,
      branch: "main",
      upstream: "origin/main",
      isDetached: false,
    });
    await operation;
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(output.status?.branch).toBe("local");
});

it("keeps successful current pull, init, undo and local trust actions working", async () => {
  await select(LOCAL_WORKSPACE);
  await render();
  await flushIdle();
  await act(async () => {
    expect(await output.runRemoteAction("pull")).toEqual({
      ok: true,
      action: "pull",
    });
  });
  expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(folder, LOCAL_WORKSPACE);
  expect(mocks.pull).toHaveBeenCalledExactlyOnceWith(folder, LOCAL_WORKSPACE);
  await act(async () => {
    await output.initRepository();
    await output.undoCommit();
    await output.trustRepository();
  });
  expect(mocks.init).toHaveBeenCalledExactlyOnceWith(folder, LOCAL_WORKSPACE);
  expect(mocks.undo).toHaveBeenCalledExactlyOnceWith(folder, LOCAL_WORKSPACE);
  expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(folder);
  expect(mocks.safe).toHaveBeenCalledExactlyOnceWith(folder, LOCAL_WORKSPACE);
});

it("publishes shared read admission before a reentrant loader", async () => {
  const value = {
    repo: {
      repoRoot: folder,
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: snapshot(),
    remoteError: null,
  };
  let joined!: ReturnType<typeof loadSharedSourceControlSnapshot>;
  const key = `reentrant-${folder}`;
  const nested = vi.fn(async () => value);
  const first = await loadSharedSourceControlSnapshot(key, key, false, () => {
    joined = loadSharedSourceControlSnapshot(key, key, false, nested);
    return Promise.resolve(value);
  });
  expect(await joined).toBe(first);
  expect(nested).not.toHaveBeenCalled();
});

it("keeps unresolved shared reads reserved until their actual settlement", async () => {
  const value = {
    repo: {
      repoRoot: folder,
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: snapshot(),
    remoteError: null,
  };
  const pending = deferred<typeof value>();
  const load = vi.fn(() => pending.promise);
  const requests = Array.from({ length: 256 }, (_, index) =>
    loadSharedSourceControlSnapshot(
      `quota-${folder}-${index}`,
      `quota-${folder}-${index}`,
      false,
      load,
    ),
  );
  await expect(
    loadSharedSourceControlSnapshot(`overflow-${folder}`, folder, false, load),
  ).rejects.toThrow("limit");
  expect(load).toHaveBeenCalledTimes(256);
  pending.resolve(value);
  await Promise.all(requests);
  await expect(
    loadSharedSourceControlSnapshot(
      `released-${folder}`,
      folder,
      false,
      async () => value,
    ),
  ).resolves.toEqual(value);
});

it("does not inherit a retired action's busy flag when navigating within its repository", async () => {
  await render();
  await flushIdle();
  const pending = deferred<void>();
  mocks.fetch.mockReturnValue(pending.promise);
  let operation!: ReturnType<typeof output.runRemoteAction>;
  await act(async () => {
    operation = output.runRemoteAction("pull");
  });
  expect(output.busyAction).toBe("pull");
  await render(`${folder}/nested`);
  const busy = output.busyAction;
  await act(async () => {
    pending.resolve();
    await operation;
  });
  expect(busy).toBeNull();
  expect(mocks.pull).not.toHaveBeenCalled();
});

it("acknowledges undo only after an admitted current native operation", async () => {
  await render();
  await flushIdle();
  await act(async () => expect(await output.undoCommit()).toBe(true));
  expect(mocks.undo).toHaveBeenCalledExactlyOnceWith(folder, ssh);
});
it("returns a negative undo acknowledgement for a retired callback", async () => {
  await render();
  await flushIdle();
  const old = output;
  await select(LOCAL_WORKSPACE);
  await act(async () => expect(await old.undoCommit()).toBe(false));
  expect(mocks.undo).not.toHaveBeenCalled();
});
it("returns a negative undo acknowledgement without a repository", async () => {
  mocks.resolve.mockResolvedValue(null);
  await render();
  await flushIdle();
  await act(async () => expect(await output.undoCommit()).toBe(false));
  expect(mocks.undo).not.toHaveBeenCalled();
});
it("does not acknowledge undo after its native completion retires", async () => {
  await render();
  await flushIdle();
  const pending = deferred<void>();
  mocks.undo.mockReturnValue(pending.promise);
  let result: Promise<unknown>;
  await act(async () => {
    result = output.undoCommit();
  });
  await select(LOCAL_WORKSPACE);
  await act(async () => {
    pending.resolve();
    expect(await result).toBe(false);
  });
  expect(mocks.undo).toHaveBeenCalledTimes(1);
});
it("rechecks undo acknowledgement after its status refresh", async () => {
  await render();
  await flushIdle();
  const pending = deferred<GitStatusSnapshot>();
  mocks.status.mockReturnValue(pending.promise);
  let operation!: Promise<unknown>;
  await act(async () => {
    operation = output.undoCommit();
  });
  expect(mocks.undo).toHaveBeenCalledTimes(1);
  await select(LOCAL_WORKSPACE);
  await act(async () => {
    pending.resolve(snapshot());
    expect(await operation).toBe(false);
  });
});
it.each(["trustRepository", "initRepository"] as const)(
  "acknowledges a current %s command",
  async (command) => {
    await render();
    await flushIdle();
    await act(async () => expect(await output[command]()).toBe(true));
  },
);
it.each(["trustRepository", "initRepository"] as const)(
  "does not acknowledge a retired %s callback",
  async (command) => {
    await render();
    await flushIdle();
    const old = output;
    await select(LOCAL_WORKSPACE);
    await act(async () => expect(await old[command]()).toBe(false));
    expect(mocks.safe).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  },
);
it.each(["trustRepository", "initRepository"] as const)(
  "does not acknowledge %s after native completion retires",
  async (command) => {
    await render();
    await flushIdle();
    const pending = deferred<void>();
    (command === "trustRepository" ? mocks.safe : mocks.init).mockReturnValue(
      pending.promise,
    );
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = output[command]();
    });
    await select(LOCAL_WORKSPACE);
    await act(async () => {
      pending.resolve();
      expect(await operation).toBe(false);
    });
  },
);
it("does not acknowledge a remote-namespace safe-directory refusal", async () => {
  await render();
  await flushIdle();
  await act(async () =>
    expect(await output.trustRepository("remote://host/project")).toBe(false),
  );
  expect(mocks.safe).not.toHaveBeenCalled();
});
it("acknowledges safe-directory success independently of repository discovery", async () => {
  await render();
  await flushIdle();
  mocks.resolve.mockResolvedValue(null);
  await act(async () => expect(await output.trustRepository()).toBe(true));
  expect(mocks.safe).toHaveBeenCalledTimes(1);
  expect(output.hasRepo).toBe(false);
});
