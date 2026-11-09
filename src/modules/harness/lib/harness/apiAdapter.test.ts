import { describe, expect, it } from "vitest";
import { getHarness } from "./registry";
import {
  apiAdapter,
  cancelApiTurn,
  ensureApiRegistered,
  forgetApiSession,
  refreshApiCatalog,
} from "./apiAdapter";
import { modelsFor } from "../models";
import { usePreferencesStore } from "@/modules/settings/preferences";

describe("apiAdapter", () => {
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
});
