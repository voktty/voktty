import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  killChild: vi.fn(async (_sessionId: string) => undefined),
  pushLine: vi.fn(),
  request: vi.fn(async () => ({ data: {} })),
  resolveOmpBinary: vi.fn(async () => ({ path: "/fake/omp" })),
  resolvePiBinary: vi.fn(async () => ({ path: "/fake/pi" })),
  spawnChild: vi.fn(
    async (
      _sessionId: string,
      _command: string,
      _args: string[],
      _cwd: string,
    ) => undefined,
  ),
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
}));

vi.mock("../fs", () => ({ homeDir: vi.fn(async () => "/home/test") }));

vi.mock("./child", () => ({
  reserveRawChild: (logicalSessionId: string) => ({
    logicalSessionId,
    nativeId: `native-${logicalSessionId}`,
    retired: false,
    spawn: (command: string, args: string[], cwd: string) =>
      mocks.spawnChild(logicalSessionId, command, args, cwd),
    watch: (
      line: (line: string) => void,
      exit: (code: number | null) => void,
    ) => {
      mocks.watchChild(logicalSessionId, line, exit);
      return () => undefined;
    },
    write: async () => undefined,
    close: async () => {
      mocks.unwatchChild(logicalSessionId);
      await mocks.killChild(logicalSessionId);
    },
  }),
  killChild: mocks.killChild,
  resolveOmpBinary: mocks.resolveOmpBinary,
  resolvePiBinary: mocks.resolvePiBinary,
  spawnChild: mocks.spawnChild,
  unwatchChild: mocks.unwatchChild,
  watchChild: mocks.watchChild,
}));

vi.mock("./piClient", () => ({
  PiRpc: class {
    close = mocks.close;
    pushLine = mocks.pushLine;
    request = mocks.request;
  },
}));

import { discoverOmpModels, discoverPiModels } from "./piCatalog";

beforeEach(() => {
  vi.clearAllMocks();
});

it("loads Pi extensions when discovering package-provided models", async () => {
  await discoverPiModels("/workspace");

  expect(mocks.spawnChild).toHaveBeenCalledWith(
    expect.any(String),
    "/fake/pi",
    ["--mode", "rpc", "--no-session"],
    "/workspace",
  );
  expect(mocks.request).toHaveBeenCalledWith(
    { type: "get_available_models" },
    45_000,
  );
});

it("keeps extension isolation for omp catalog probes", async () => {
  await discoverOmpModels("/workspace");

  expect(mocks.spawnChild).toHaveBeenCalledWith(
    expect.any(String),
    "/fake/omp",
    expect.arrayContaining(["--no-extensions"]),
    "/workspace",
  );
  expect(mocks.request).toHaveBeenCalledWith(
    { type: "get_available_models" },
    45_000,
  );
});
