// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceSwitcher } from "@/app/hooks/useWorkspaceSwitcher";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { Tab } from "@/modules/tabs";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  publish: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    workspaceAuthorize: mocks.authorize,
    workspaceCurrentDir: async () => "/local/project",
  },
}));
vi.mock("@/modules/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/modules/remote/sessionManager", () => ({
  openHeldRemoteSession: mocks.open,
  closeRemoteSessionById: mocks.close,
}));
vi.mock("@/modules/spaces/lib/useSpaces", () => ({
  useSpaces: { getState: () => ({ spaces: [] }) },
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/local/home" }));

type SshEnv = Extract<WorkspaceEnv, { kind: "ssh" }>;
function ssh(root: string, sessionId?: number): SshEnv {
  return {
    kind: "ssh",
    root,
    sessionId,
    connection: {
      id: "build",
      name: "Build",
      host: "build.example",
      user: "dev",
      port: 22,
    },
  };
}

let root: Root;
let container: HTMLDivElement;
let controls: ReturnType<typeof useWorkspaceSwitcher>;
const tabsRef = { current: [] as Tab[] };
function View({ current }: { current: WorkspaceEnv }) {
  controls = useWorkspaceSwitcher({
    tabsRef,
    workspaceEnv: current,
    setWorkspaceEnv: mocks.publish,
    resetWorkspace: vi.fn(),
    clearWorkspaceState: vi.fn(),
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.open.mockImplementation(
    async (_holder, _profile, _connection, root) => ({
      session_id: 71,
      workspace_root: root,
    }),
  );
  mocks.close.mockResolvedValue(undefined);
  mocks.authorize.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function activate(current: WorkspaceEnv, requested: WorkspaceEnv) {
  await act(async () => root.render(<View current={current} />));
  mocks.publish.mockClear();
  let result: WorkspaceEnv | null = null;
  await act(async () => {
    result = await controls.activateWorkspaceEnv(requested);
  });
  return result;
}

it.each(["/srv/app", "/srv/other"])(
  "preserves the requested native session for %s",
  async (path) => {
    const requested = ssh(path, 71);
    expect(await activate(ssh("/srv/app", 42), requested)).toBe(requested);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(requested);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  },
);

it("opens the requested root instead of borrowing another root on the same host", async () => {
  const requested = ssh("/srv/other");
  expect(await activate(ssh("/srv/app", 42), requested)).toMatchObject({
    root: "/srv/other",
    sessionId: 71,
  });
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
    "workspace",
    "build",
    requested.connection,
    "/srv/other",
  );
  expect(mocks.close).not.toHaveBeenCalled();
});

it.each([
  { host: "other.example" },
  { user: "other" },
  { port: 2222 },
  { identityFile: "/keys/other" },
  { extraArgs: "-o ProxyJump=bastion" },
  { initialDirectory: "/srv/new" },
])(
  "does not reuse the selected session after connection configuration changes (%j)",
  async (patch) => {
    const requested = ssh("/srv/app");
    requested.connection = { ...requested.connection, ...patch };
    expect(await activate(ssh("/srv/app", 42), requested)).toMatchObject({
      sessionId: 71,
      connection: requested.connection,
    });
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
      "workspace",
      "build",
      requested.connection,
      "/srv/app",
    );
    expect(mocks.close).not.toHaveBeenCalled();
  },
);

it("keeps an exact connected workspace reusable without opening another helper", async () => {
  const current = ssh("/srv/app", 42);
  expect(await activate(current, ssh("/srv/app"))).toBe(current);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("reuses the exact helper while preserving requested multiplexer settings", async () => {
  const requested = ssh("/srv/app");
  requested.connection = {
    ...requested.connection,
    multiplexerMode: "tmux",
    activeMultiplexerSession: "work",
    multiplexerAction: "attach_force",
  };
  expect(await activate(ssh("/srv/app", 42), requested)).toMatchObject({
    sessionId: 42,
    connection: requested.connection,
  });
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("preserves a requested profile's native session even when authentication matches the active profile", async () => {
  const requested = ssh("/srv/app", 71);
  requested.connection = { ...requested.connection, id: "other-profile" };
  expect(await activate(ssh("/srv/app", 42), requested)).toBe(requested);
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(requested);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("acquires the requested profile's helper when it has no native session yet", async () => {
  const requested = ssh("/srv/app");
  requested.connection = { ...requested.connection, id: "other-profile" };
  expect(await activate(ssh("/srv/app", 42), requested)).toMatchObject({
    sessionId: 71,
    connection: requested.connection,
  });
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
    "workspace",
    "other-profile",
    requested.connection,
    "/srv/app",
  );
  expect(mocks.close).not.toHaveBeenCalled();
});

it("fails the requested connection without closing the selected helper", async () => {
  mocks.open.mockRejectedValueOnce(new Error("connect failed"));
  await expect(
    activate(ssh("/srv/app", 42), ssh("/srv/other")),
  ).rejects.toThrow("connect failed");
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});
