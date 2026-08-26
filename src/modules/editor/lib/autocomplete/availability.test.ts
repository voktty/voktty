import { describe, expect, it } from "vitest";
import { hasAutocompleteAccess } from "./availability";

describe("hasAutocompleteAccess", () => {
  it("accepts a configured cloud provider key", () => {
    expect(
      hasAutocompleteAccess({ provider: "deepseek", apiKey: "sk-test" }),
    ).toBe(true);
  });

  it("rejects a cloud provider without a key", () => {
    expect(hasAutocompleteAccess({ provider: "deepseek", apiKey: null })).toBe(
      false,
    );
  });

  it.each([
    ["lmstudio", "lmstudioBaseURL"],
    ["mlx", "mlxBaseURL"],
    ["ollama", "ollamaBaseURL"],
    ["openai-compatible", "openaiCompatibleBaseURL"],
  ] as const)("accepts a configured %s endpoint", (provider, field) => {
    expect(
      hasAutocompleteAccess({
        provider,
        apiKey: null,
        [field]: "http://127.0.0.1:1234/v1",
      }),
    ).toBe(true);
  });
});
