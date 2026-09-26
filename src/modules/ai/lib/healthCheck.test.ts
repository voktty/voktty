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

describe("runAiHealthCheck reasoning truncation", () => {
  beforeEach(() => vi.clearAllMocks());

  const openrouterConfig = {
    ...config,
    modelId: "openrouter-custom",
    openrouterModelId: "z-ai/glm-5.3",
  };

  async function queueResults(results: unknown[]) {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockReset();
    for (const result of results)
      vi.mocked(generateText).mockResolvedValueOnce(result as never);
    return generateText;
  }

  const truncated = { text: "", finishReason: "length", reasoning: ["..."] };
  const visible = { text: "OK", finishReason: "stop" };

  it("retries a truncated reasoning-only probe once with a larger budget", async () => {
    const signal = new AbortController().signal;
    const generateText = await queueResults([truncated, visible]);

    await expect(
      runAiHealthCheck(openrouterConfig, signal),
    ).resolves.toMatchObject({ latencyMs: expect.any(Number) });

    expect(generateText).toHaveBeenCalledTimes(2);
    const calls = vi
      .mocked(generateText)
      .mock.calls.map(([options]) => options);
    expect(calls.map((options) => options.maxOutputTokens)).toEqual([8, 256]);
    expect(calls[0].model).toBe(calls[1].model);
    expect(calls[0].prompt).toBe(calls[1].prompt);
    expect(calls[0].abortSignal).toBe(signal);
    expect(calls[1].abortSignal).toBe(signal);
  });

  it("does not retry when the first probe already returns visible text", async () => {
    const generateText = await queueResults([visible]);

    await expect(runAiHealthCheck(openrouterConfig)).resolves.toMatchObject({
      latencyMs: expect.any(Number),
    });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("does not retry an empty response that was not truncated", async () => {
    const generateText = await queueResults([
      { text: "", finishReason: "stop" },
    ]);

    await expect(runAiHealthCheck(openrouterConfig)).rejects.toThrow(
      "empty response",
    );
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("fails when the retry also returns no visible text", async () => {
    const generateText = await queueResults([truncated, truncated]);

    await expect(runAiHealthCheck(openrouterConfig)).rejects.toThrow(
      "empty response",
    );
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("propagates provider errors without retrying", async () => {
    const generateText = await queueResults([]);
    vi.mocked(generateText).mockRejectedValueOnce(
      new Error("429: rate limit exceeded"),
    );

    await expect(runAiHealthCheck(openrouterConfig)).rejects.toThrow("429");
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("propagates cancellation without starting a second request", async () => {
    const generateText = await queueResults([]);
    vi.mocked(generateText).mockRejectedValueOnce(
      new DOMException("aborted", "AbortError"),
    );

    await expect(runAiHealthCheck(openrouterConfig)).rejects.toThrow();
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["openai-compatible-custom", "openai-compatible"],
    ["gpt-5.4-mini", "openai"],
    ["deepseek-v4-flash", "deepseek"],
    ["claude-sonnet-5", "anthropic"],
  ])("keeps a single 8-token probe for %s (%s)", async (modelId) => {
    const generateText = await queueResults([truncated]);

    await expect(runAiHealthCheck({ ...config, modelId })).rejects.toThrow(
      "empty response",
    );
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 8 }),
    );
  });

  it("keeps the native DeepSeek thinking override on its single probe", async () => {
    const generateText = await queueResults([truncated]);

    await expect(
      runAiHealthCheck({ ...config, modelId: "deepseek-v4-flash" }),
    ).rejects.toThrow("empty response");
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 8,
        providerOptions: {
          deepseek: { thinking: { type: "disabled" } },
        },
      }),
    );
  });

  it("reports a latency that covers the whole OpenRouter probe", async () => {
    await queueResults([truncated, visible]);

    const { latencyMs } = await runAiHealthCheck(openrouterConfig);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(latencyMs)).toBe(true);
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
