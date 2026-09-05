import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const open = vi.fn();
const close = vi.fn();
const disconnect = vi.fn();
let backend = "helper";

vi.mock("./client", () => ({
  sshNativeConnect: (...args: unknown[]) => connect(...args),
  sshNativeDisconnect: (...args: unknown[]) => disconnect(...args),
  sftpOpen: (...args: unknown[]) => open(...args),
  sftpClose: (...args: unknown[]) => close(...args),
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ remoteFilesystemBackend: backend }),
  },
}));

const {
  ensureNativeHandle,
  nativeHandleFor,
  nativeHandleKeys,
  releaseNativeHandle,
  resetNativeHandles,
  workspaceKey,
} = await import("./handles");

type Env = Parameters<typeof workspaceKey>[0];

function env(overrides: Record<string, unknown> = {}): Env {
  return {
    kind: "ssh",
    root: "/srv/app",
    connection: { host: "example.com", port: 2222, user: "root" },
    ...overrides,
  } as Env;
}

beforeEach(() => {
  resetNativeHandles();
  connect.mockReset();
  open.mockReset();
  close.mockReset();
  disconnect.mockReset();
  backend = "helper";
  connect.mockResolvedValue({ id: "ssh-1" });
  open.mockResolvedValue({ handle: "sftp-1", root: "/srv/app" });
  close.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(undefined);
});

describe("workspaceKey", () => {
  it("identifies the connection and root, not the helper session", () => {
    expect(workspaceKey(env())).toBe("root@example.com:2222/srv/app");
  });

  it("defaults the port to 22", () => {
    expect(workspaceKey(env({ connection: { host: "h" } }))).toBe("@h:22/srv/app");
  });

  it("separates two roots on the same host", () => {
    expect(workspaceKey(env())).not.toBe(workspaceKey(env({ root: "/other" })));
  });
});

describe("ensureNativeHandle", () => {
  it("opens a session and a channel once", async () => {
    const state = await ensureNativeHandle(env());
    expect(state).toEqual({
      kind: "ready",
      handle: "sftp-1",
      sessionId: "ssh-1",
      root: "/srv/app",
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("ssh-1", "/srv/app");
  });

  it("shares one attempt between concurrent callers", async () => {
    const [first, second] = await Promise.all([
      ensureNativeHandle(env()),
      ensureNativeHandle(env()),
    ]);
    expect(first).toEqual(second);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("records a failure instead of throwing, and does not retry it", async () => {
    connect.mockRejectedValue({ code: "auth_failed", message: "no key" });

    const state = await ensureNativeHandle(env());
    expect(state).toEqual({
      kind: "unavailable",
      error: { code: "auth_failed", message: "no key" },
    });

    await ensureNativeHandle(env());
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("does not leave a session behind when the channel fails to open", async () => {
    open.mockRejectedValue({ code: "protocol", message: "no sftp subsystem" });

    const state = await ensureNativeHandle(env());
    expect(state.kind).toBe("unavailable");
    expect(disconnect).toHaveBeenCalledWith("ssh-1");
  });

  it("normalizes an unexpected rejection", async () => {
    connect.mockRejectedValue(new Error("boom"));
    const state = await ensureNativeHandle(env());
    expect(state).toEqual({
      kind: "unavailable",
      error: { code: "protocol", message: "boom" },
    });
  });
});

describe("nativeHandleFor", () => {
  it("answers nothing while the preference asks for the helper", async () => {
    expect(await nativeHandleFor(env())).toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
  });

  it("answers the handle once the preference asks for native", async () => {
    backend = "native";
    expect(await nativeHandleFor(env())).toBe("sftp-1");
  });

  it("falls back to the helper when the native handle is unavailable", async () => {
    backend = "native";
    connect.mockRejectedValue({ code: "unreachable", message: "down" });
    expect(await nativeHandleFor(env())).toBeUndefined();
  });
});

describe("releaseNativeHandle", () => {
  it("closes the channel and the session, and forgets the workspace", async () => {
    await ensureNativeHandle(env());
    expect(nativeHandleKeys()).toHaveLength(1);

    await releaseNativeHandle(env());
    expect(close).toHaveBeenCalledWith("sftp-1");
    expect(disconnect).toHaveBeenCalledWith("ssh-1");
    expect(nativeHandleKeys()).toHaveLength(0);
  });

  it("is a no-op for a workspace that was never opened", async () => {
    await releaseNativeHandle(env());
    expect(close).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("closes nothing for a workspace whose attempt failed", async () => {
    connect.mockRejectedValue({ code: "auth_failed", message: "no key" });
    await ensureNativeHandle(env());

    await releaseNativeHandle(env());
    expect(close).not.toHaveBeenCalled();
    expect(nativeHandleKeys()).toHaveLength(0);
  });
});
