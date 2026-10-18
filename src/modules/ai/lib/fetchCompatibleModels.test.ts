import { describe, expect, it, vi } from "vitest";
import {
  buildModelEndpoints,
  fetchCompatibleModels,
} from "./fetchCompatibleModels";

describe("buildModelEndpoints", () => {
  it("returns empty array for empty inputs", () => {
    expect(buildModelEndpoints("")).toEqual([]);
    expect(buildModelEndpoints("   ")).toEqual([]);
  });

  it("handles urls already ending in /models", () => {
    expect(buildModelEndpoints("https://api.example.com/v1/models")).toEqual([
      "https://api.example.com/v1/models",
    ]);
    expect(buildModelEndpoints("https://api.example.com/v1/models/")).toEqual([
      "https://api.example.com/v1/models",
    ]);
  });

  it("handles urls ending in /v1", () => {
    expect(buildModelEndpoints("https://api.example.com/v1")).toEqual([
      "https://api.example.com/v1/models",
    ]);
    expect(buildModelEndpoints("https://api.example.com/v1/")).toEqual([
      "https://api.example.com/v1/models",
    ]);
  });

  it("provides fallback for root urls", () => {
    expect(buildModelEndpoints("https://api.example.com")).toEqual([
      "https://api.example.com/models",
      "https://api.example.com/v1/models",
    ]);
  });
});

describe("fetchCompatibleModels", () => {
  it("fetches and parses standard OpenAI { data: [...] } format", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [
          { id: "gpt-4o", created: 123 },
          { id: "deepseek-r1", created: 124 },
          { id: "phi-4", created: 125 },
        ],
      }),
    });

    const models = await fetchCompatibleModels("https://api.example.com/v1", {
      apiKey: "test-secret-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(models).toEqual(["deepseek-r1", "gpt-4o", "phi-4"]);
    expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/v1/models", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-secret-key",
        "api-key": "test-secret-key",
      },
      signal: undefined,
    });
  });

  it("falls back to /v1/models if /models returns 404", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not found",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "model-v1" }],
        }),
      });

    const models = await fetchCompatibleModels("https://api.example.com", {
      apiKey: "azure-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(models).toEqual(["model-v1"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/models",
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/v1/models",
      expect.anything(),
    );
  });

  it("handles array payload directly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "llama-3.3" }, { id: "qwen-2.5" }],
    });

    const models = await fetchCompatibleModels("https://local-runner/v1", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(models).toEqual(["llama-3.3", "qwen-2.5"]);
  });

  it("throws descriptive error on HTTP failures", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized: Invalid subscription key",
    });

    await expect(
      fetchCompatibleModels("https://api.example.com/v1", {
        apiKey: "bad-key",
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 401: Unauthorized: Invalid subscription key");
  });
});
