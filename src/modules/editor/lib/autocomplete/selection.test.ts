import { describe, expect, it } from "vitest";
import { resolveAutocompleteSelection } from "./selection";

const base = {
  autocompleteProvider: "openai" as const,
  autocompleteModelId: "gpt-5.4-nano",
  lmstudioBaseURL: "http://localhost:1234/v1",
  lmstudioModelId: "local-lm",
  mlxBaseURL: "http://localhost:8080/v1",
  mlxModelId: "local-mlx",
  ollamaBaseURL: "http://localhost:11434/v1",
  ollamaModelId: "qwen3-coder",
  openaiCompatibleBaseURL: "",
  openaiCompatibleModelId: "",
  openrouterModelId: "",
  customEndpoints: [],
};

describe("resolveAutocompleteSelection", () => {
  it("resolves a named compatible endpoint and its protocol profile", () => {
    expect(
      resolveAutocompleteSelection({
        ...base,
        autocompleteProvider: "openai-compatible",
        autocompleteModelId: "compat-deep",
        customEndpoints: [
          {
            id: "deep",
            name: "Private gateway",
            baseURL: "https://example.test/v1",
            modelId: "deepseek-r1",
            contextLimit: 128_000,
            autocompleteProfile: "deepseek",
          },
        ],
      }),
    ).toMatchObject({
      provider: "openai-compatible",
      modelId: "deepseek-r1",
      openaiCompatibleBaseURL: "https://example.test/v1",
      profileOverride: "deepseek",
      endpointId: "deep",
    });
  });

  it("uses the configured model id for local runtimes", () => {
    expect(
      resolveAutocompleteSelection({
        ...base,
        autocompleteProvider: "ollama",
        autocompleteModelId: "",
      }).modelId,
    ).toBe("qwen3-coder");
  });
});
