import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  killChild: vi.fn(async () => undefined),
  pushLine: vi.fn(),
  request: vi.fn(async () => ({ data: {} })),
  resolveOmpBinary: vi.fn(async () => ({ path: "/fake/omp" })),
  resolvePiBinary: vi.fn(async () => ({ path: "/fake/pi" })),
  spawnChild: vi.fn(async () => undefined),
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
}));

vi.mock("../fs", () => ({ homeDir: vi.fn(async () => "/home/test") }));

vi.mock("./child", () => ({
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
