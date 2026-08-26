import { describe, expect, it } from "vitest";
import { buildCompletionPlan } from "./profiles";

describe("buildCompletionPlan", () => {
  it("disables thinking for DeepSeek", () => {
    const plan = buildCompletionPlan({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      declaredReasoning: true,
    });

    expect(plan.profile).toBe("deepseek");
    expect(plan.attempts[0]).toMatchObject({
      maxOutputTokens: 128,
      providerOptions: {
        deepseek: { thinking: { type: "disabled" } },
      },
    });
    expect(plan.attempts[1]).toEqual({ maxOutputTokens: 512 });
  });

  it("falls back from disabled to low reasoning for Ollama GPT-OSS", () => {
    const plan = buildCompletionPlan({
      provider: "ollama",
      modelId: "gpt-oss:20b",
      declaredReasoning: false,
    });

    expect(plan.profile).toBe("ollama");
    expect(plan.attempts).toHaveLength(2);
    expect(plan.attempts[0].providerOptions).toEqual({
      ollama: { reasoningEffort: "none" },
    });
    expect(plan.attempts[1]).toMatchObject({
      maxOutputTokens: 512,
      providerOptions: { ollama: { reasoningEffort: "low" } },
    });
  });

  it("uses the endpoint namespace for a custom DeepSeek profile", () => {
    const plan = buildCompletionPlan({
      provider: "openai-compatible",
      modelId: "vendor-model",
      declaredReasoning: false,
      profileOverride: "deepseek",
    });

    expect(plan.attempts[0].providerOptions).toEqual({
      "openai-compatible": { thinking: { type: "disabled" } },
    });
  });

  it("keeps generic non-reasoning endpoints free of vendor options", () => {
    const plan = buildCompletionPlan({
      provider: "openai-compatible",
      modelId: "coder-small",
      declaredReasoning: false,
      profileOverride: "generic",
    });

    expect(plan.profile).toBe("generic");
    expect(plan.attempts).toEqual([
      { maxOutputTokens: 128 },
      { maxOutputTokens: 128 },
    ]);
  });

  it.each([
    ["openai", "gpt-5-mini"],
    ["anthropic", "claude-sonnet"],
    ["google", "gemini-flash"],
    ["xai", "grok-code"],
    ["cerebras", "qwen-3-coder"],
    ["groq", "qwen-3-32b"],
    ["deepseek", "deepseek-chat"],
    ["mistral", "codestral"],
    ["openrouter", "vendor/coder"],
    ["openai-compatible", "custom-coder"],
    ["lmstudio", "local-coder"],
    ["mlx", "mlx-coder"],
    ["ollama", "qwen2.5-coder:7b"],
  ] as const)(
    "bounds the %s profile to two same-model attempts",
    (provider, modelId) => {
      const plan = buildCompletionPlan({
        provider,
        modelId,
        declaredReasoning: false,
      });

      expect(plan.attempts.length).toBeGreaterThanOrEqual(1);
      expect(plan.attempts.length).toBeLessThanOrEqual(2);
      expect(
        plan.attempts.every((attempt) => attempt.maxOutputTokens <= 1024),
      ).toBe(true);
    },
  );
});
