import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolvers = vi.hoisted(() => ({
  resolveClaudeBinary: vi.fn(),
  resolveCodexBinary: vi.fn(),
  resolveCursorBinary: vi.fn(),
  resolveFxBinary: vi.fn(),
  resolveGeminiBinary: vi.fn(),
  resolveGrokBinary: vi.fn(),
  resolveHermesBinary: vi.fn(),
  resolveOmpBinary: vi.fn(),
  resolveOpenCodeBinary: vi.fn(),
  resolvePiBinary: vi.fn(),
}));

vi.mock("./child", () => resolvers);
vi.mock("./registry", () => ({ isLiveHarness: () => true }));

async function loadAvailability() {
  vi.resetModules();
  return import("./availability");
}

beforeEach(() => {
  for (const resolver of Object.values(resolvers)) {
    resolver.mockReset();
    resolver.mockResolvedValue({ path: "/fake/cli" });
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("harness availability", () => {
  it("probes only the harnesses requested by the mounted window", async () => {
    const { isHarnessAvailable, probeHarnessAvailability } = await loadAvailability();

    await probeHarnessAvailability({ ids: ["codex", "codex", "claude"] });

    expect(resolvers.resolveCodexBinary).toHaveBeenCalledOnce();
    expect(resolvers.resolveClaudeBinary).toHaveBeenCalledOnce();
    expect(resolvers.resolveCursorBinary).not.toHaveBeenCalled();
    expect(resolvers.resolvePiBinary).not.toHaveBeenCalled();
    expect(isHarnessAvailable("codex")).toBe(true);
    expect(isHarnessAvailable("claude")).toBe(true);
  });
});
