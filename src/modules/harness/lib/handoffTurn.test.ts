import { describe, expect, it, vi } from "vitest";

const cancelHarnessTurn = vi.fn(async () => undefined);
const sendHarnessTurn = vi.fn(() => new Promise<void>(() => undefined));

vi.mock("./harness/registry", () => ({
  cancelHarnessTurn,
  respondHarnessApproval: vi.fn(),
  sendHarnessTurn,
}));

const { requestOutgoingHandoff } = await import("./handoffTurn");

describe("requestOutgoingHandoff", () => {
  it("falls back instead of hanging when the outgoing adapter never settles", async () => {
    const result = requestOutgoingHandoff({
      harness: "codex",
      sessionId: "stuck",
      cwd: "/repo",
      model: "codex:test",
      userRequest: "continue",
      timeoutMs: 10,
    });

    await expect(result).resolves.toBe("");
    expect(cancelHarnessTurn).toHaveBeenCalledWith("codex", "stuck");
  });
});
