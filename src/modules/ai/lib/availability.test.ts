import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../config";
import type { ProviderKeys } from "./keyring";
import {
  hasCurrentAiHealth,
  isAiAvailable,
  isProviderUsable,
} from "./availability";

const current = {
  aiEnabled: true,
  aiConfigRevision: 4,
  aiHealthRevision: 4,
  aiHealthCheckedAt: 100,
};

describe("AI availability contract", () => {
  it("requires explicit activation and a current successful health check", () => {
    expect(hasCurrentAiHealth(current)).toBe(true);
    expect(isAiAvailable(current)).toBe(true);
    expect(isAiAvailable({ ...current, aiEnabled: false })).toBe(false);
  });

  it("revokes availability after configuration changes", () => {
    expect(
      isAiAvailable({ ...current, aiConfigRevision: 5, aiEnabled: true }),
    ).toBe(false);
  });

  it("does not accept a revision without a completed check timestamp", () => {
    expect(hasCurrentAiHealth({ ...current, aiHealthCheckedAt: null })).toBe(
      false,
    );
  });
});

describe("isProviderUsable", () => {
  const noKeys = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, null]),
  ) as ProviderKeys;

  it("accepts a local agent provider that holds no key at all", () => {
    // Regression: falling through to the key check hid every local agent
    // model from the chat picker while Settings had one selected and verified.
    expect(
      isProviderUsable("harness", noKeys, { harnessProviderEnabled: true }),
    ).toBe(true);
  });

  it("rejects the local agent provider while it is switched off", () => {
    expect(isProviderUsable("harness", noKeys, {})).toBe(false);
    expect(
      isProviderUsable("harness", noKeys, { harnessProviderEnabled: false }),
    ).toBe(false);
  });

  it("still requires a key for the providers that use one", () => {
    expect(isProviderUsable("anthropic", noKeys, {})).toBe(false);
    expect(
      isProviderUsable("anthropic", { ...noKeys, anthropic: "sk-x" }, {}),
    ).toBe(true);
  });

  it("requires a model id from the local servers, not a key", () => {
    expect(isProviderUsable("ollama", noKeys, {})).toBe(false);
    expect(
      isProviderUsable("ollama", noKeys, { ollamaModelId: "llama3" }),
    ).toBe(true);
    expect(isProviderUsable("lmstudio", noKeys, { lmstudioModelId: " " })).toBe(
      false,
    );
  });

  it("requires both a key and a model id for openrouter", () => {
    expect(
      isProviderUsable("openrouter", { ...noKeys, openrouter: "k" }, {}),
    ).toBe(false);
    expect(
      isProviderUsable("openrouter", noKeys, { openrouterModelId: "m" }),
    ).toBe(false);
    expect(
      isProviderUsable(
        "openrouter",
        { ...noKeys, openrouter: "k" },
        { openrouterModelId: "m" },
      ),
    ).toBe(true);
  });

  it("accepts an openai-compatible provider with either a custom endpoint or a base url", () => {
    expect(isProviderUsable("openai-compatible", noKeys, {})).toBe(false);
    expect(
      isProviderUsable("openai-compatible", noKeys, {
        customEndpoints: [{ id: "e1" } as never],
      }),
    ).toBe(true);
    expect(
      isProviderUsable("openai-compatible", noKeys, {
        openaiCompatibleBaseURL: "http://localhost:1234",
        openaiCompatibleModelId: "m",
      }),
    ).toBe(true);
  });
});
