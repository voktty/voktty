import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const open = vi.fn();
const close = vi.fn();
const disconnect = vi.fn();
const requestPrompt = vi.fn();
let backend = "helper";
let language = "en";

vi.mock("./client", () => ({
  sshNativeConnect: (...args: unknown[]) => connect(...args),
  sshNativeDisconnect: (...args: unknown[]) => disconnect(...args),
  sftpOpen: (...args: unknown[]) => open(...args),
  sftpClose: (...args: unknown[]) => close(...args),
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ remoteFilesystemBackend: backend, language }),
  },
}));
vi.mock("@/modules/ssh/promptQueue", () => ({
  requestSshPrompt: (...args: unknown[]) => requestPrompt(...args),
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
  vi.useRealTimers();
  connect.mockReset();
  open.mockReset();
  close.mockReset();
  disconnect.mockReset();
  requestPrompt.mockReset();
  requestPrompt.mockResolvedValue(null);
  backend = "helper";
  language = "en";
  connect.mockResolvedValue({ id: "ssh-1" });
  open.mockResolvedValue({ handle: "sftp-1", root: "/srv/app" });
  close.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(undefined);
});

describe("workspaceKey", () => {
  it("identifies the connection and root, not the helper session", () => {
    expect(JSON.parse(workspaceKey(env()))).toEqual([null, "root", "example.com", 2222, null, null, "/srv/app"]);
  });

  it("defaults the port to 22", () => {
    expect(JSON.parse(workspaceKey(env({ connection: { host: "h" } })))[3]).toBe(22);
  });

  it("separates two roots on the same host", () => {
    expect(workspaceKey(env())).not.toBe(workspaceKey(env({ root: "/other" })));
  });

  it("separates identities and proxy settings on the same host", () => {
    expect(workspaceKey(env())).not.toBe(workspaceKey(env({ connection: { host: "example.com", port: 2222, user: "root", identityFile: "key" } })));
    expect(workspaceKey(env())).not.toBe(workspaceKey(env({ connection: { host: "example.com", port: 2222, user: "root", extraArgs: "-J bastion" } })));
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

  it("backs off failed attempts, then retries", async () => {
    vi.useFakeTimers();
    connect.mockRejectedValue({ code: "auth_failed", message: "no key" });

    const state = await ensureNativeHandle(env());
    expect(state).toEqual({
      kind: "unavailable",
      error: { code: "auth_failed", message: "no key" },
    });

    await ensureNativeHandle(env());
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_001);
    await ensureNativeHandle(env());
    expect(connect).toHaveBeenCalledTimes(2);
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

  it("retries an explicitly approved host key using the exact presented key", async () => {
    connect.mockRejectedValueOnce({ code: "host_key_unknown", message: "unknown", prompt: {
      host: "example.com", port: 2222, keyType: "ssh-ed25519", keyBase64: "presented-key", fingerprint: "SHA256:test", changed: false,
    } });
    requestPrompt.mockResolvedValueOnce("yes");
    await ensureNativeHandle(env());
    expect(connect).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), {
      kind: "approve", keyBase64: "presented-key", remember: true,
    });
  });

  it("does not approve a revoked host key", async () => {
    connect.mockRejectedValueOnce({ code: "host_key_revoked", message: "revoked", prompt: {
      host: "example.com", port: 2222, keyType: "ssh-ed25519", keyBase64: "revoked", fingerprint: "SHA256:test", changed: true,
    } });
    expect((await ensureNativeHandle(env())).kind).toBe("unavailable");
    expect(requestPrompt).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("does not approve a key presented for a different port", async () => {
    connect.mockRejectedValueOnce({ code: "host_key_unknown", message: "wrong port", prompt: {
      host: "example.com", port: 22, keyType: "ssh-ed25519", keyBase64: "wrong-port", fingerprint: "SHA256:test", changed: false,
    } });
    expect((await ensureNativeHandle(env())).kind).toBe("unavailable");
    expect(requestPrompt).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("stops when the host key is declined", async () => {
    connect.mockRejectedValueOnce({ code: "host_key_unknown", message: "unknown", prompt: {
      host: "example.com", port: 2222, keyType: "ssh-ed25519", keyBase64: "declined", fingerprint: "SHA256:test", changed: false,
    } });
    expect((await ensureNativeHandle(env())).kind).toBe("unavailable");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("retries a private key only after its passphrase is supplied", async () => {
    connect.mockRejectedValueOnce({ code: "auth_failed", message: "encrypted key" });
    requestPrompt.mockResolvedValueOnce("typed-passphrase");
    const state = await ensureNativeHandle(env({ connection: {
      host: "example.com", port: 2222, user: "root", identityFile: "/keys/test-key",
    } }));
    expect(state.kind).toBe("ready");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenNthCalledWith(2, expect.anything(), [
      { kind: "agent" }, { kind: "privateKey", path: "/keys/test-key", passphrase: "typed-passphrase" },
    ], { kind: "none" });
    expect(requestPrompt).toHaveBeenCalledTimes(1);
  });

  it("keeps the approved key when password authentication is needed", async () => {
    connect.mockRejectedValueOnce({ code: "host_key_unknown", message: "unknown", prompt: {
      host: "example.com", port: 2222, keyType: "ssh-ed25519", keyBase64: "approved", fingerprint: "SHA256:test", changed: false,
    } });
    connect.mockRejectedValueOnce({ code: "auth_failed", message: "no key" });
    requestPrompt.mockResolvedValueOnce("yes").mockResolvedValueOnce("typed-password");
    expect((await ensureNativeHandle(env())).kind).toBe("ready");
    expect(connect).toHaveBeenCalledTimes(3);
    expect(connect).toHaveBeenNthCalledWith(3, expect.anything(), [
      { kind: "password", secret: "typed-password" },
    ], { kind: "approve", keyBase64: "approved", remember: true });
  });

  it("localizes the changed-key warning and trust question", async () => {
    const { loadLocale } = await import("@/modules/i18n");
    await loadLocale("es");
    language = "es";
    connect.mockRejectedValueOnce({ code: "host_key_changed", message: "changed", prompt: {
      host: "example.com", port: 2222, keyType: "ssh-ed25519", keyBase64: "changed", fingerprint: "SHA256:test", changed: true,
    } });
    await ensureNativeHandle(env());
    expect(requestPrompt).toHaveBeenCalledWith(
      "ADVERTENCIA: La clave del servidor SSH ha cambiado\nexample.com:2222\nssh-ed25519 SHA256:test\n\n¿Confiar en esta clave?", true,
    );
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("uses a user-entered password only after key authentication fails", async () => {
    connect.mockRejectedValueOnce({ code: "auth_failed", message: "no key" });
    requestPrompt.mockResolvedValueOnce("typed-password");
    await ensureNativeHandle(env());
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenNthCalledWith(2, expect.anything(), [
      { kind: "password", secret: "typed-password" },
    ], { kind: "none" });
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
