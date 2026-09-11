import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiHealthCheckErrorDetail,
  aiHealthCheckTimeoutMs,
  runAiHealthCheck,
} from "./healthCheck";
import { EMPTY_PROVIDER_KEYS } from "./keyring";

vi.mock("./agent", () => ({
  buildConfiguredLanguageModel: vi.fn().mockResolvedValue({ id: "model" }),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

const config = {
  modelId: "gpt-5.4-mini",
  keys: EMPTY_PROVIDER_KEYS,
  customEndpointKeys: {},
  lmstudioBaseURL: "",
  lmstudioModelId: "",
  mlxBaseURL: "",
  mlxModelId: "",
  ollamaBaseURL: "",
  ollamaModelId: "",
  openaiCompatibleBaseURL: "",
  openaiCompatibleModelId: "",
  openrouterModelId: "",
  customEndpoints: [],
};

describe("runAiHealthCheck", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a real non-empty model response", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({ text: "OK" } as never);
    await expect(runAiHealthCheck(config)).resolves.toMatchObject({
      latencyMs: expect.any(Number),
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Reply with OK.", maxOutputTokens: 8 }),
    );
  });

  it("rejects an empty response", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({ text: "   " } as never);
    await expect(runAiHealthCheck(config)).rejects.toThrow("empty response");
  });

  it("disables thinking for a bounded DeepSeek connectivity check", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({ text: "OK" } as never);

    await runAiHealthCheck({ ...config, modelId: "deepseek-v4-flash" });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          deepseek: { thinking: { type: "disabled" } },
        },
      }),
    );
  });
});

describe("aiHealthCheckTimeoutMs", () => {
  it("allows local OAuth agents enough time to initialize", () => {
    expect(aiHealthCheckTimeoutMs("harness-codex")).toBe(75_000);
    expect(aiHealthCheckTimeoutMs("gpt-5.4-mini")).toBe(20_000);
  });
});

describe("aiHealthCheckErrorDetail", () => {
  it("exposes bounded local agent errors without exposing cloud failures", () => {
    expect(
      aiHealthCheckErrorDetail(
        "harness-codex",
        new Error("OAuth session\nexpired"),
      ),
    ).toBe("OAuth session expired");
    expect(
      aiHealthCheckErrorDetail(
        "gpt-5.4-mini",
        new Error("request included secret context"),
      ),
    ).toBeUndefined();
  });
});
