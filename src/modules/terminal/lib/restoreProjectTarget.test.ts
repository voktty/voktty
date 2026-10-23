import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  hydrateTabs,
  serializeTabs,
  remoteTerminalSnapshot,
} from "@/modules/spaces/lib/serialize";
import {
  repairSessionSnapshot,
  snapshotFromRuntime,
} from "@/modules/spaces/lib/sessionSnapshot";
import type { TerminalTab } from "@/modules/tabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { terminalRestoreProject } from "@/modules/tabs/lib/terminalProjectRestore";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import {
  openPty,
  cancelPtyConnection,
} from "@/modules/terminal/lib/pty-bridge";
import {
  useWorkspaceEnvStore,
  workspaceEnvForNativePty,
} from "@/modules/workspace";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
import type { SshConnection } from "@/modules/ssh/types";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  invoke: vi.fn(),
  profiles: [] as SshConnection[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: mocks.acquire },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ sshConnections: mocks.profiles }) },
}));
vi.mock("@/modules/harness/lib/harnessEnvStore", () => ({
  useHarnessProjectEnvStore: { getState: () => ({ projects: {} }) },
  harnessProjectEnvironmentFor: () => ({ env: { kind: "local" } }),
}));

const project = "remote://voktty-ssh-build/srv/app";
const profile: SshConnection = {
  id: "build",
  name: "Build",
  host: "build.example",
  identityFile: "/keys/private-marker",
  multiplexerMode: "none",
};
function original(): TerminalTab {
  return {
    id: 1,
    ...createTabIdentity("main", () => "remote-tab"),
    spaceId: "main",
    kind: "terminal",
    title: "Tests",
    customTitle: "Tests",
    projectCwd: project,
    cwd: "/srv/app/src",
    blocks: true,
    locked: true,
    color: "red",
    icon: "terminal",
    workspaceEnv: {
      kind: "ssh",
      connection: profile,
      root: "/srv/app",
      sessionId: 99,
    },
    paneTree: { kind: "leaf", id: 2, cwd: "/srv/app/src" },
    activeLeafId: 2,
  };
}
function restored() {
  let id = 100;
  const [tab] = hydrateTabs(serializeTabs([original()]), "main", () => id++);
  if (tab?.kind !== "terminal") throw new Error("Missing restored terminal.");
  return tab;
}
function lease(id = 7): RemoteSessionLease {
  return {
    info: {
      session_id: id,
      workspace_root: "/srv/app",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    },
    release: vi.fn().mockResolvedValue(undefined),
  };
}
function open(tab: TerminalTab, leafId = tab.activeLeafId) {
  return openPty(
    80,
    24,
    { onData: vi.fn() },
    tab.cwd,
    tab.blocks,
    undefined,
    leafId,
    tab.workspaceEnv,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles = [{ ...profile }];
  mocks.invoke.mockImplementation(async (command) =>
    command === "remote_pty_open" ? 91 : undefined,
  );
  mocks.acquire.mockResolvedValue(lease());
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
});
afterEach(async () => {
  await ownedPtyTargets.close(100);
  await ownedPtyTargets.close(200);
  expect(ownedPtyTargets.size()).toBe(0);
});

it("round-trips a project terminal in schema2 without connection secrets or native IDs", () => {
  const tab = original();
  const snapshot = snapshotFromRuntime({
    tabs: [tab],
    activeTabId: tab.id,
    workspaceContexts: [],
    activeWorkspaceContextId: null,
    viewSpaces: [],
    stripEntries: [{ kind: "standalone", tabKey: tab.tabKey }],
    activeStripItem: { kind: "tab", tabKey: tab.tabKey },
  });
  expect(snapshot.schemaVersion).toBe(2);
  expect(snapshot.tabs[0]).toMatchObject({
    remoteProject: project,
    projectCwd: project,
    tree: { cwd: "remote://voktty-ssh-build/srv/app/src", active: true },
    customTitle: "Tests",
    blocks: true,
    locked: true,
    color: "red",
  });
  expect(JSON.stringify(snapshot.tabs)).not.toMatch(
    /private-marker|sessionId|connection|identityFile/,
  );
  expect(repairSessionSnapshot(snapshot).tabs).toEqual(snapshot.tabs);
  const next = restored();
  expect(next).toMatchObject({
    cold: true,
    tabKey: tab.tabKey,
    projectCwd: project,
    workspaceEnv: { kind: "ssh", restoredProjectCwd: project },
  });
  expect(next.workspaceEnv).not.toHaveProperty("sessionId");
  const workspace = next.workspaceEnv;
  if (!workspace) throw new Error("Missing restored workspace.");
  expect(() => workspaceEnvForNativePty(workspace)).toThrow("Resolve");
});

it.each([
  "remote://user:secret@host/srv/app",
  "remote://voktty-ssh-%ZZ/srv/app",
  "remote://voktty-ssh-/srv/app",
  "remote://voktty-ssh-build/bad\0path",
])(
  "rejects malformed persisted projects without reinterpreting their tree locally: %s",
  (remoteProject) => {
    expect(terminalRestoreProject(remoteProject)).toBeUndefined();
    expect(
      hydrateTabs(
        [
          {
            kind: "terminal",
            remoteProject,
            tree: { kind: "leaf", cwd: "/srv/app" },
          },
        ],
        "main",
        () => 1,
      ),
    ).toEqual([]);
  },
);

it("copies only allowed descriptor and tree fields, rejecting cross-host folders", () => {
  const serialized = serializeTabs([original()])[0];
  if (serialized.kind !== "terminal") throw new Error("Missing terminal.");
  const contaminated = {
    ...serialized,
    sessionId: 99,
    secret: "private-marker",
    tree: { kind: "leaf" as const, cwd: "/srv/app/src", nativeId: 91 },
  };
  const repaired = remoteTerminalSnapshot(contaminated);
  expect(JSON.stringify(repaired)).not.toMatch(
    /private-marker|nativeId|sessionId/,
  );
  expect(
    remoteTerminalSnapshot({
      ...serialized,
      tree: { kind: "leaf", cwd: "remote://voktty-ssh-other/srv/app" },
    }),
  ).toBeNull();
  expect(
    serializeTabs([
      {
        ...original(),
        workspaceEnv: {
          kind: "ssh",
          connection: { ...profile, id: "other" },
          root: "/srv/app",
        },
      },
    ]),
  ).toEqual([]);
});

it("resolves the saved project before opening its leaf, preserving the project root", async () => {
  const tab = restored();
  const owned = lease();
  mocks.acquire.mockImplementationOnce(async (...args) => {
    expect(ownedPtyTargets.get(tab.activeLeafId)).toBeDefined();
    expect(args[0]).toEqual({ profileId: "build", root: "/srv/app" });
    return owned;
  });
  const session = await open(tab);
  expect(session.workspace).toMatchObject({
    kind: "ssh",
    sessionId: 7,
    connection: { host: "build.example" },
  });
  expect(session.workspace).toHaveProperty("restoredProjectCwd", project);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "remote_pty_open",
    expect.objectContaining({
      sessionId: 7,
      cwd: "/srv/app/src",
      blocks: true,
    }),
  );
  expect(
    mocks.invoke.mock.calls.some(([command]) => command === "pty_open"),
  ).toBe(false);
  await session.close();
  expect(owned.release).toHaveBeenCalledOnce();
});

it("keeps a missing profile retryable and never borrows the selected connection", async () => {
  const tab = restored();
  mocks.profiles = [];
  useWorkspaceEnvStore.setState({
    env: {
      kind: "ssh",
      connection: profile,
      root: "/srv/other",
      sessionId: 66,
    },
  });
  await expect(open(tab)).rejects.toThrow("missing");
  expect(mocks.acquire).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.profiles = [{ ...profile, host: "updated.example" }];
  await open(tab);
  expect(mocks.acquire).toHaveBeenCalledWith(
    { profileId: "build", root: "/srv/app" },
    expect.objectContaining({ host: "updated.example" }),
  );
});

it("acquires independent leases for restored sibling leaves", async () => {
  const tab = restored();
  const first = lease(7);
  const second = lease(8);
  mocks.acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const a = await open(tab);
  const b = await open(tab, 200);
  await a.close();
  expect(first.release).toHaveBeenCalledOnce();
  expect(second.release).not.toHaveBeenCalled();
  expect(b.workspace).toMatchObject({ sessionId: 8 });
  await b.close();
  expect(second.release).toHaveBeenCalledOnce();
});

it("retains failed acknowledged lease cleanup and retries without repeating native close", async () => {
  const tab = restored();
  const destination = lease();
  destination.releaseAndClose = vi
    .fn()
    .mockRejectedValueOnce(new Error("helper close failed"))
    .mockResolvedValueOnce(undefined);
  mocks.acquire.mockResolvedValueOnce(destination);
  const session = await open(tab);
  await expect(session.close()).rejects.toThrow("helper close failed");
  expect(ownedPtyTargets.size()).toBe(1);
  expect(destination.release).not.toHaveBeenCalled();
  await ownedPtyTargets.close(tab.activeLeafId);
  expect(destination.releaseAndClose).toHaveBeenCalledTimes(2);
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "remote_pty_close",
    ),
  ).toHaveLength(1);
});

it("releases a late acquired lease after cancellation without opening a native PTY", async () => {
  const tab = restored();
  let resolve!: (value: RemoteSessionLease) => void;
  mocks.acquire.mockReturnValueOnce(
    new Promise<RemoteSessionLease>((done) => {
      resolve = done;
    }),
  );
  const opening = open(tab);
  const rejected = expect(opening).rejects.toThrow("retired");
  await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledOnce());
  cancelPtyConnection(tab.activeLeafId);
  const late = lease();
  resolve(late);
  await rejected;
  await ownedPtyTargets.close(tab.activeLeafId);
  expect(late.release).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
