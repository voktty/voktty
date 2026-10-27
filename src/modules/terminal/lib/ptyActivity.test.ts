import { beforeEach, expect, it, vi } from "vitest";
import { openPty, type PtySession } from "@/modules/terminal/lib/pty-bridge";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import type { WorkspaceEnv } from "@/modules/workspace";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as { onmessage: (value: unknown) => void }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class {
    onmessage: (value: unknown) => void = () => {};
    constructor() {
      native.channels.push(this);
    }
  },
}));

const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  sessionId: 17,
  connection: { id: "remote", name: "Remote", host: "host.invalid" },
};
const probe = (pty: PtySession, kind: "process" | "job") => {
  if (!pty.inspectActivity) throw new Error("Missing transport activity probe");
  return pty.inspectActivity(kind);
};
beforeEach(() => {
  native.channels.length = 0;
  native.invoke.mockReset().mockImplementation((command: string) => {
    if (command.endsWith("pty_open")) return Promise.resolve(91);
    if (command === "remote_request")
      return Promise.resolve({ ok: true, result: { foregroundJob: true } });
    return Promise.resolve(false);
  });
});

it("retires pending idle observations before a throwing native exit observer", async () => {
  let resolve!: (value: unknown) => void;
  const response = new Promise((done) => {
    resolve = done;
  });
  native.invoke.mockImplementation((command: string) =>
    command === "remote_pty_open" ? Promise.resolve(91) : response,
  );
  const onExit = vi.fn(() => {
    throw new Error("exit observer failed");
  });
  const remote = await openPty(
    80,
    24,
    { onData: vi.fn(), onExit },
    "/project",
    false,
    undefined,
    undefined,
    ssh,
  );
  const pending = probe(remote, "process");
  expect(() => native.channels[1].onmessage(0)).toThrow("exit observer failed");
  resolve({ ok: true, result: { foregroundJob: false } });
  expect(await pending).toBe(true);
  native.invoke.mockClear();
  expect(await probe(remote, "job")).toBe(true);
  expect(native.invoke).not.toHaveBeenCalled();
});

it("keeps unresolved probes charged through retirement and admits fresh probes after settlement", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  native.invoke.mockImplementation((command: string) =>
    command === "remote_pty_open"
      ? Promise.resolve(91)
      : command === "remote_request"
        ? pending
        : Promise.resolve(),
  );
  const resources = await Promise.all(
    Array.from({ length: 257 }, () =>
      openPty(
        80,
        24,
        { onData: vi.fn() },
        "/project",
        false,
        undefined,
        undefined,
        ssh,
      ),
    ),
  );
  const probes = resources.slice(0, 256).map((pty) => probe(pty, "process"));
  expect(await probe(resources[256], "process")).toBe(true);
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "remote_request",
    ),
  ).toHaveLength(256);
  await resources[0].close();
  expect(await probe(resources[256], "process")).toBe(true);
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "remote_request",
    ),
  ).toHaveLength(256);
  resolve({ ok: true, result: { foregroundJob: false } });
  const results = await Promise.all(probes);
  expect(results[0]).toBe(true);
  expect(results.slice(1).every((busy) => !busy)).toBe(true);
  expect(await probe(resources[256], "process")).toBe(false);
  await Promise.all(resources.map((pty) => pty.close()));
});

it("routes identical local and remote PTY IDs to their captured transports", async () => {
  const local = await openPty(
    80,
    24,
    { onData: vi.fn() },
    "/project",
    false,
    undefined,
    undefined,
    { kind: "local" },
  );
  const remote = await openPty(
    80,
    24,
    { onData: vi.fn() },
    "/project",
    false,
    undefined,
    undefined,
    ssh,
  );
  expect(local.id).toBe(remote.id);
  expect(await probe(local, "process")).toBe(false);
  expect(await probe(remote, "process")).toBe(true);
  expect(await probe(local, "job")).toBe(false);
  expect(await probe(remote, "job")).toBe(true);
  expect(native.invoke).toHaveBeenCalledWith("pty_has_foreground_process", {
    id: 91,
  });
  expect(native.invoke).toHaveBeenCalledWith("pty_has_foreground_job", {
    id: 91,
  });
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "remote_request",
    ),
  ).toEqual([
    [
      "remote_request",
      {
        sessionId: 17,
        request: expect.objectContaining({
          method: "pty.getActivity",
          params: { ptyId: 91 },
        }),
      },
    ],
    [
      "remote_request",
      {
        sessionId: 17,
        request: expect.objectContaining({
          method: "pty.getActivity",
          params: { ptyId: 91 },
        }),
      },
    ],
  ]);
});

it.each([undefined, {}, { foregroundJob: "false" }, { foregroundJob: false }])(
  "validates remote activity instead of assuming missing facts are idle (%j)",
  async (result) => {
    native.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "remote_pty_open" ? 91 : { ok: true, result },
      ),
    );
    const remote = await openPty(
      80,
      24,
      { onData: vi.fn() },
      "/project",
      false,
      undefined,
      undefined,
      ssh,
    );
    expect(await probe(remote, "process")).toBe(
      result?.foregroundJob !== false,
    );
    expect(native.invoke).not.toHaveBeenCalledWith(
      "pty_has_foreground_process",
      expect.anything(),
    );
  },
);

it("preserves confirmation when the remote helper is old or unavailable", async () => {
  native.invoke.mockImplementation((command: string) =>
    command === "remote_pty_open"
      ? Promise.resolve(91)
      : Promise.resolve({
          ok: false,
          error: { code: "method_not_found", message: "old helper" },
        }),
  );
  const remote = await openPty(
    80,
    24,
    { onData: vi.fn() },
    "/project",
    false,
    undefined,
    undefined,
    ssh,
  );
  expect(await probe(remote, "process")).toBe(true);
  native.invoke.mockRejectedValue(new Error("connection lost"));
  expect(await probe(remote, "job")).toBe(true);
});

it("retires old replies and coalesces simultaneous probes of one resource", async () => {
  let resolve!: (value: unknown) => void;
  const response = new Promise((done) => {
    resolve = done;
  });
  native.invoke.mockImplementation((command: string) =>
    command === "remote_pty_open"
      ? Promise.resolve(91)
      : command === "remote_request"
        ? response
        : Promise.resolve(),
  );
  const remote = await openPty(
    80,
    24,
    { onData: vi.fn() },
    "/project",
    false,
    undefined,
    undefined,
    ssh,
  );
  const first = probe(remote, "process");
  const joined = probe(remote, "process");
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "remote_request",
    ),
  ).toHaveLength(1);
  await remote.close();
  resolve({ ok: true, result: { foregroundJob: false } });
  expect(await first).toBe(true);
  expect(await joined).toBe(true);
  native.invoke.mockClear();
  expect(await probe(remote, "job")).toBe(true);
  expect(native.invoke).not.toHaveBeenCalled();
});

it("preserves the probe through project ownership and retires before native close settles", async () => {
  const receipt = ownedPtyTargets.register(285, {
    cwd: "/project",
    workspace: ssh as Extract<WorkspaceEnv, { kind: "ssh" }>,
    release: vi.fn().mockResolvedValue(undefined),
  });
  try {
    const remote = await openPty(
      80,
      24,
      { onData: vi.fn() },
      "/project",
      false,
      undefined,
      285,
      ssh,
    );
    expect(await probe(remote, "process")).toBe(true);
    const close = remote.close();
    native.invoke.mockClear();
    expect(await probe(remote, "job")).toBe(true);
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "remote_request",
      ),
    ).toBe(false);
    await close;
  } finally {
    await receipt.dispose();
  }
});
