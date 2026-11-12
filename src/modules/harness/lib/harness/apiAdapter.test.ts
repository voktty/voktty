import { describe, expect, it, vi } from "vitest";

const keys = vi.hoisted(() => ({ current: {} as Record<string, string | null> }));
vi.mock("@/modules/ai/lib/keyring", () => ({
  getAllKeys: vi.fn(async () => ({ ...keys.current })),
  getCustomEndpointKey: vi.fn(async () => null),
}));
vi.mock("@/modules/settings/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/settings/store")>()),
  onKeysChanged: vi.fn(async () => () => undefined),
}));
import { getHarness } from "./registry";
import {
  apiAdapter,
  boundedApiHistory,
  cancelApiTurn,
  ensureApiRegistered,
  forgetApiSession,
  refreshApiCatalog,
} from "./apiAdapter";
import { modelsFor } from "../models";
import { usePreferencesStore } from "@/modules/settings/preferences";

describe("apiAdapter", () => {
  it("bounds history by dropping complete oldest turns", () => {
    const recent = [{ role: "user" as const, content: "recent" }, { role: "assistant" as const, content: "answer" }];
    expect(boundedApiHistory([{ role: "user", content: "x".repeat(1024 * 1024) }, { role: "assistant", content: "old" }, ...recent])).toEqual(recent);
    expect(boundedApiHistory([{ role: "user", content: "x".repeat(1024 * 1024) }])).toEqual([]);
  });
  it("registers in the harness registry", () => {
    ensureApiRegistered();
    expect(getHarness("api")).toBe(apiAdapter);
    expect(apiAdapter.live).toBe(true);
    expect(apiAdapter.id).toBe("api");
  });

  it("handles cancelApiTurn and forgetApiSession gracefully", async () => {
    await expect(cancelApiTurn("non-existent-session")).resolves.toBeUndefined();
    await expect(forgetApiSession("non-existent-session")).resolves.toBeUndefined();
  });

  it("refreshes catalog from preferences store", async () => {
    usePreferencesStore.setState({
      customEndpoints: [
        {
          id: "test-gateway",
          name: "Test Gateway",
          baseURL: "https://gateway.test/v1",
          modelId: "meta-llama-3",
          models: ["meta-llama-3", "deepseek-coder"],
          contextLimit: 32_000,
        },
      ],
    });

    await refreshApiCatalog();
    const models = modelsFor("api");
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("api:test-gateway:meta-llama-3");
    expect(models[1].id).toBe("api:test-gateway:deepseek-coder");
  });

  it("lists the models of built-in providers that have a saved key", async () => {
    usePreferencesStore.setState({ customEndpoints: [] });
    keys.current = { deepseek: "sk-test" };
    await refreshApiCatalog();
    const ids = modelsFor("api").map((model) => model.id);
    expect(ids).toContain("apikey:deepseek:deepseek-flash");
    expect(ids).toContain("apikey:deepseek:deepseek-v4-pro");
    expect(ids.some((id) => id.startsWith("apikey:openai:"))).toBe(false);
    expect(ids.some((id) => id.endsWith("-custom"))).toBe(false);
  });

  it("keeps keyed models when endpoints change and drops them with the key", async () => {
    keys.current = { deepseek: "sk-test" };
    await refreshApiCatalog();
    usePreferencesStore.setState({
      customEndpoints: [
        {
          id: "gw",
          name: "GW",
          baseURL: "https://gw.test/v1",
          modelId: "m",
          contextLimit: 32_000,
        },
      ],
    });
    await refreshApiCatalog();
    let ids = modelsFor("api").map((model) => model.id);
    expect(ids).toContain("api:gw:m");
    expect(ids).toContain("apikey:deepseek:deepseek-flash");
    keys.current = {};
    await refreshApiCatalog();
    ids = modelsFor("api").map((model) => model.id);
    expect(ids).toEqual(["api:gw:m"]);
  });

  it("lists configured local and custom-slot providers, not unconfigured ones", async () => {
    keys.current = { openrouter: "sk-or" };
    usePreferencesStore.setState({
      customEndpoints: [],
      ollamaModelId: "qwen3:8b",
      lmstudioModelId: "",
      openrouterModelId: "anthropic/claude-sonnet-5",
    });
    await refreshApiCatalog();
    const models = modelsFor("api");
    const ids = models.map((model) => model.id);
    expect(ids).toContain("apikey:ollama:ollama-local");
    expect(ids).toContain("apikey:openrouter:openrouter-custom");
    expect(ids).not.toContain("apikey:lmstudio:lmstudio-local");
    expect(ids.some((id) => id.startsWith("apikey:harness:"))).toBe(false);
    expect(
      models.find((model) => model.id === "apikey:ollama:ollama-local")?.name,
    ).toBe("Ollama: qwen3:8b");
  });

  it("does not repeat a provider already connected as a third-party endpoint", async () => {
    keys.current = { deepseek: "sk-test" };
    usePreferencesStore.setState({
      ollamaModelId: "",
      openrouterModelId: "",
      customEndpoints: [
        {
          id: "ds",
          name: "DeepSeek",
          baseURL: "https://api.deepseek.com",
          modelId: "deepseek-flash",
          isThirdParty: true,
          providerType: "deepseek",
          contextLimit: 128_000,
        },
      ],
    });
    await refreshApiCatalog();
    const ids = modelsFor("api").map((model) => model.id);
    expect(ids).toEqual(["api:ds:deepseek-flash"]);
  });
});
