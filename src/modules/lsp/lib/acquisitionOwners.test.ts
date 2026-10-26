// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireDocExtension } from "@/modules/lsp/lib/sessionManager";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { VokttyLspClient } from "@/modules/lsp/lib/client";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
  shutdown: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: io.invoke,
  Channel: class {
    onmessage = (_data: ArrayBuffer) => {};
  },
}));
vi.mock("sonner", () => ({ toast: { error: io.error } }));
vi.mock("@/modules/lsp/lib/detect", () => ({
  detectBinary: async () => "/bin/server",
}));
let resolvePid: (value: number) => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  VokttyLspClient.hostPid = null;
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  io.start.mockResolvedValue(undefined);
  io.shutdown.mockResolvedValue(undefined);
  const pid = new Promise<number>((resolve) => {
    resolvePid = resolve;
  });
  const channels = new Map<
    number,
    { onmessage: (data: ArrayBuffer) => void }
  >();
  let nextId = 0;
  io.invoke.mockImplementation(
    (
      command: string,
      params: {
        path?: string;
        id: number;
        message: string;
        onMessage: { onmessage: (data: ArrayBuffer) => void };
      },
    ) => {
      if (command === "lsp_host_pid") return pid;
      if (command === "lsp_resolve_root")
        return Promise.resolve(params.path?.replace(/\/file.ts$/, ""));
      if (command === "lsp_spawn") {
        const id = ++nextId;
        channels.set(id, params.onMessage);
        return io.start(params).then(() => id);
      }
      if (command === "lsp_kill") {
        channels.delete(params.id);
        io.close();
        return Promise.resolve();
      }
      if (command === "lsp_send") {
        const message = JSON.parse(params.message);
        if (message.method === "shutdown") io.shutdown();
        if (message.id !== undefined) {
          const result =
            message.method === "initialize" ? { capabilities: {} } : null;
          const response = new TextEncoder().encode(
            JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
          );
          void Promise.resolve().then(() =>
            channels.get(params.id)?.onmessage(response.buffer),
          );
        }
        return Promise.resolve();
      }
      throw new Error(`Unexpected LSP command: ${command}`);
    },
  );
  usePreferencesStore.setState({
    lspActivation: { typescript: "enabled" },
    lspCustomServers: [],
  });
});
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(180_000);
  vi.useRealTimers();
});
async function waitForPid() {
  await vi.waitFor(() =>
    expect(
      io.invoke.mock.calls.some((call) => call[0] === "lsp_host_pid"),
    ).toBe(true),
  );
}
it("does not start a native transport when every opening caller retires", async () => {
  let current = true;
  const work = acquireDocExtension(
    "/work/cancelled/file.ts",
    "ts",
    { kind: "local" },
    undefined,
    undefined,
    () => current,
  );
  await waitForPid();
  current = false;
  resolvePid(123);
  expect(await work).toBeNull();
  expect(io.start).not.toHaveBeenCalled();
});
it("keeps a live sibling's shared startup after the first caller retires", async () => {
  let firstCurrent = true;
  const first = acquireDocExtension(
    "/work/shared/file.ts",
    "ts",
    { kind: "local" },
    undefined,
    undefined,
    () => firstCurrent,
  );
  await waitForPid();
  const sibling = acquireDocExtension("/work/shared/file.ts", "ts", {
    kind: "local",
  });
  await vi.waitFor(() =>
    expect(
      io.invoke.mock.calls.filter((call) => call[0] === "lsp_resolve_root"),
    ).toHaveLength(2),
  );
  firstCurrent = false;
  resolvePid(123);
  const [oldHandle, liveHandle] = await Promise.all([first, sibling]);
  expect(oldHandle).toBeNull();
  expect(liveHandle).not.toBeNull();
  expect(io.start).toHaveBeenCalledOnce();
  expect(io.close).not.toHaveBeenCalled();
  liveHandle?.release();
});
it("reclaims a newly started session when its last caller retires during native startup", async () => {
  let finish!: () => void;
  io.start.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  let current = true;
  const work = acquireDocExtension(
    "/work/late/file.ts",
    "ts",
    { kind: "local" },
    undefined,
    undefined,
    () => current,
  );
  await waitForPid();
  resolvePid(123);
  await vi.waitFor(() => expect(io.start).toHaveBeenCalledOnce());
  current = false;
  finish();
  expect(await work).toBeNull();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(io.close).toHaveBeenCalledOnce();
});
it("counts opening roots against the four-server budget while allowing a same-root sibling", async () => {
  const work = Array.from({ length: 5 }, (_, i) =>
    acquireDocExtension(`/work/root-${i}/file.ts`, "ts", { kind: "local" }),
  );
  await waitForPid();
  const sibling = acquireDocExtension("/work/root-0/file.ts", "ts", {
    kind: "local",
  });
  resolvePid(123);
  const handles = await Promise.all([...work, sibling]);
  expect(io.error).not.toHaveBeenCalled();
  expect(handles.filter(Boolean)).toHaveLength(5);
  expect(handles[4]).toBeNull();
  expect(io.start).toHaveBeenCalledTimes(4);
  handles.forEach((handle) => {
    handle?.release();
  });
});

it("sends the admitted local filesystem through the real transport after global selection changes", async () => {
  const work = acquireDocExtension("/work/local/file.ts", "ts", {
    kind: "local",
  });
  await waitForPid();
  useWorkspaceEnvStore.setState({
    env: {
      kind: "ssh",
      root: "/work",
      connection: { id: "remote", name: "Remote", host: "example.test" },
    },
  });
  resolvePid(123);
  const handle = await work;
  expect(handle).not.toBeNull();
  expect(io.invoke).toHaveBeenCalledWith(
    "lsp_spawn",
    expect.objectContaining({
      root: "/work/local",
      workspace: { kind: "local" },
    }),
  );
  handle?.release();
});
