import { describe, expect, it } from "vitest";
import {
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  estimateCost,
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_MODEL_ID,
  getModelContextLimit,
  isKnownModelId,
  isCompatModelId,
  migrateLegacyCompatEndpoint,
  modelKeepsReasoning,
  modelSupportsTemperature,
  modelUsesReasoningTokens,
  MODEL_PRICING,
  resolveModel,
  type CustomEndpoint,
} from "./config";

const endpoint: CustomEndpoint = {
  id: "ab12cd34",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  modelId: "llama-3.3-70b",
  contextLimit: 64_000,
};

describe("compat model id helpers", () => {
  it("round-trips endpoint id through the synthetic model id", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(isCompatModelId(mid)).toBe(true);
    expect(endpointIdFromCompatModel(mid)).toBe(endpoint.id);
  });

  it("treats static model ids as non-compat", () => {
    expect(isCompatModelId("gpt-5.4-mini")).toBe(false);
    expect(endpointIdFromCompatModel("gpt-5.4-mini")).toBe("");
  });
});

describe("resolveModel", () => {
  it("resolves a compat model id against its endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    const info = resolveModel(mid, [endpoint]);
    expect(info.provider).toBe("openai-compatible");
    expect(info.id).toBe(mid);
    expect(info.label).toBe(endpoint.modelId);
  });

  it("falls back to a placeholder when the endpoint is gone", () => {
    const info = resolveModel(compatModelIdForEndpoint("missing"), []);
    expect(info.provider).toBe("openai-compatible");
  });

  it("resolves a static model id from the registry", () => {
    expect(resolveModel("gpt-5.4-mini").provider).toBe("openai");
  });

  it.each([
    ["gpt-6.1-sol", "openai"],
    ["gpt-6-astra", "openai"],
    ["gpt-6-luna", "openai"],
    ["claude-opus-5-5", "anthropic"],
    ["claude-sonnet-5-5", "anthropic"],
    ["claude-haiku-5-5", "anthropic"],
    ["gemini-3.8-flash", "google"],
    ["gemini-3.1-pro-preview", "google"],
    ["grok-4.7", "xai"],
    ["deepseek-flash", "deepseek"],
    ["mistral-medium-3-5", "mistral"],
  ] as const)("resolves catalog model %s through %s", (modelId, provider) => {
    expect(resolveModel(modelId).provider).toBe(provider);
  });

  it.each([
    ["gpt-5.6", "gpt-6.1-sol"],
    ["gpt-5.6-luna", "gpt-6-luna"],
    ["gemini-3.7-flash", "gemini-3.8-flash"],
    ["gemini-3.1-pro", "gemini-3.1-pro-preview"],
    ["deepseek-v4-flash", "deepseek-flash"],
    ["mistral-medium-latest", "mistral-medium-3-5"],
    ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  ])("resolves saved model id %s to current model %s", (legacy, current) => {
    expect(resolveModel(legacy).id).toBe(current);
    expect(isKnownModelId(legacy)).toBe(false);
  });

  it("preserves older models that are still explicitly selectable", () => {
    expect(resolveModel("claude-opus-4-6").id).toBe("claude-opus-4-6");
    expect(resolveModel("claude-haiku-4-5").id).toBe("claude-haiku-4-5");
  });

  it("uses the current general-purpose model as the default", () => {
    expect(DEFAULT_MODEL_ID).toBe("gpt-6.1-sol");
  });

  it.each([
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.7-flash",
  ])("omits deprecated temperature settings for %s", (modelId) => {
    expect(modelSupportsTemperature("google", modelId)).toBe(false);
  });

  it("throws on an unknown static model id", () => {
    expect(() => resolveModel("nope-not-real")).toThrow();
  });
});

describe("getModelContextLimit", () => {
  it("uses the per-endpoint override for compat models", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(getModelContextLimit(mid, endpoint.contextLimit)).toBe(64_000);
  });

  it("reads the static table for known models", () => {
    expect(getModelContextLimit("claude-opus-4-7")).toBe(1_000_000);
  });

  it.each([
    ["gpt-6.1-sol", 1_050_000],
    ["claude-opus-5-5", 1_000_000],
    ["claude-haiku-5-5", 1_000_000],
    ["gemini-3.8-flash", 1_000_000],
    ["gemini-3.5-flash-lite", 1_000_000],
    ["grok-4.7", 500_000],
    ["deepseek-flash", 1_000_000],
    ["mistral-medium-3-5", 256_000],
  ] as const)("uses the published context limit for %s", (modelId, limit) => {
    expect(getModelContextLimit(modelId)).toBe(limit);
  });

  it("keeps the previous context when resolving a saved model id", () => {
    expect(getModelContextLimit("gpt-5.6")).toBe(
      getModelContextLimit("gpt-6.1-sol"),
    );
  });
});

describe("current model pricing", () => {
  it.each([
    ["gpt-6-astra", 10, 50, 1],
    ["gpt-6.1-sol", 2, 10, 0.1],
    ["gpt-6-luna", 0.1, 0.5, 0.01],
    ["claude-opus-5-5", 4, 20, 0.2],
    ["claude-sonnet-5-5", 2, 10, 0.1],
    ["claude-haiku-5-5", 0.1, 0.5, 0.01],
    ["gemini-3.8-flash", 0.75, 3.75, 0.075],
    ["gemini-3.5-flash-lite", 0.3, 2.5, 0.03],
    ["gemini-3.6-flash", 0.75, 3.75, 0.075],
    ["grok-4.7", 2, 6, 0.5],
    ["deepseek-flash", 0.3, 1.2, 0.006],
    ["deepseek-v4-pro", 1.32, 3.96, 0.044],
    ["claude-fable-5", 10, 50, 1],
    ["grok-4.5", 2, 6, 0.5],
  ] as const)("uses the published token pricing for %s", (modelId, input, output, cacheRead) => {
    expect(MODEL_PRICING[modelId]).toEqual({ input, output, cacheRead });
  });

  it("estimates saved model ids with current pricing", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 };
    expect(estimateCost("gpt-5.6", usage)).toBe(
      estimateCost("gpt-6.1-sol", usage),
    );
  });

  it("uses current fast models for inline completions", () => {
    expect(DEFAULT_AUTOCOMPLETE_MODEL).toMatchObject({
      openai: "gpt-6-luna",
      anthropic: "claude-haiku-5-5",
      google: "gemini-3.5-flash-lite",
      xai: "grok-4.7",
      deepseek: "deepseek-flash",
    });
  });
});

describe("modelKeepsReasoning", () => {
  it("keeps reasoning for compat endpoints (freeform provider)", () => {
    const info = resolveModel(compatModelIdForEndpoint(endpoint.id), [endpoint]);
    expect(modelKeepsReasoning(info)).toBe(true);
  });

  it("drops reasoning for plain non-reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("gpt-5.4-mini"))).toBe(false);
  });

  it("keeps reasoning for tagged reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("claude-opus-4-7"))).toBe(true);
  });
});

describe("model sampling capabilities", () => {
  it.each([
    ["openai", "gpt-5.4-nano"],
    ["openai", "gpt-5.6"],
    ["anthropic", "claude-fable-5"],
    ["anthropic", "claude-sonnet-5"],
  ] as const)("omits temperature for %s/%s", (provider, modelId) => {
    expect(modelSupportsTemperature(provider, modelId)).toBe(false);
  });

  it("keeps temperature for models that accept sampling parameters", () => {
    expect(modelSupportsTemperature("openai", "gpt-4.1-mini")).toBe(true);
    expect(modelSupportsTemperature("xai", "grok-4.5")).toBe(true);
  });

  it("defaults unknown provider models to temperature support", () => {
    expect(modelSupportsTemperature("openai-compatible", "custom-model")).toBe(
      true,
    );
  });

  it.each([
    ["openai", "gpt-5.4-nano"],
    ["openai", "gpt-5.6-luna"],
    ["anthropic", "claude-sonnet-5"],
    ["xai", "grok-4.5"],
    ["groq", "openai/gpt-oss-20b"],
  ] as const)("allocates a reasoning output budget for %s/%s", (provider, modelId) => {
    expect(modelUsesReasoningTokens(provider, modelId)).toBe(true);
  });
});

describe("migrateLegacyCompatEndpoint", () => {
  it("migrates a fully configured legacy endpoint", () => {
    const out = migrateLegacyCompatEndpoint(
      "https://api.example.com/v1",
      "llama-3.3-70b",
      32_000,
      "fixedid1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "fixedid1",
      baseURL: "https://api.example.com/v1",
      modelId: "llama-3.3-70b",
      contextLimit: 32_000,
    });
  });

  it("skips migration when base URL or model id is missing", () => {
    expect(migrateLegacyCompatEndpoint("", "m", 1, "x")).toEqual([]);
    expect(migrateLegacyCompatEndpoint("u", "  ", 1, "x")).toEqual([]);
  });
});
