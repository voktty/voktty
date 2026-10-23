import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  acquire: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: mocks.acquire,
}));
import { killAllPtys, startOwnedPty } from "@/modules/harness/lib/pty";

afterEach(async () => {
  mocks.invoke.mockResolvedValue(undefined);
  await killAllPtys();
  vi.resetAllMocks();
});

it("retries the captured SSH PTY close through the real bridge before releasing the helper", async () => {
  const operations: string[] = [];
  const releaseAndClose = vi.fn(async () => {
    operations.push("helper close");
  });
  mocks.acquire.mockResolvedValue({
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: 71,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    lease: { info: { session_id: 71 }, releaseAndClose },
  });
  let closes = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    operations.push(command);
    if (command === "remote_pty_open") return 91;
    if (command === "remote_pty_close" && closes++ === 0)
      throw new Error("remote close not acknowledged");
    return undefined;
  });
  const owner = startOwnedPty("native-rpc", "remote://build/srv/app", 80, 24);
  await owner.ready;
  await expect(owner.close()).rejects.toThrow("remote close not acknowledged");
  expect(releaseAndClose).not.toHaveBeenCalled();
  await owner.write("retired\r");
  await owner.close();
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "remote_pty_close",
    ),
  ).toEqual([
    ["remote_pty_close", { sessionId: 71, ptyId: 91 }],
    ["remote_pty_close", { sessionId: 71, ptyId: 91 }],
  ]);
  expect(operations).toEqual([
    "remote_pty_open",
    "remote_pty_close",
    "remote_pty_close",
    "helper close",
  ]);
  await owner.close();
  expect(releaseAndClose).toHaveBeenCalledOnce();
});
