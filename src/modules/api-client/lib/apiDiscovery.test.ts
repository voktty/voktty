import { describe, expect, it, vi } from "vitest";
import { discoverApiEndpoints } from "./apiDiscovery";

vi.mock("./apiTauriBridge", () => ({
  sendApiRequest: vi.fn(async (req: { url: string }) => {
    if (req.url.includes("/products")) {
      return {
        status: 200,
        statusText: "OK",
        headers: [],
        body: JSON.stringify({ products: [], total: 0 }),
        bodyBytesLen: 30,
        isJson: true,
        jsonValue: { products: [], total: 0 },
        timings: { totalDurationMs: 15 },
        timestamp: Date.now(),
      };
    }
    if (req.url.includes("/users")) {
      return {
        status: 200,
        statusText: "OK",
        headers: [],
        body: JSON.stringify({ users: [], total: 0 }),
        bodyBytesLen: 20,
        isJson: true,
        jsonValue: { users: [], total: 0 },
        timings: { totalDurationMs: 22 },
        timestamp: Date.now(),
      };
    }
    return {
      status: 404,
      statusText: "Not Found",
      headers: [],
      body: JSON.stringify({ ok: false }),
      bodyBytesLen: 15,
      isJson: true,
      timings: { totalDurationMs: 10 },
      timestamp: Date.now(),
    };
  }),
}));

describe("apiDiscovery", () => {
  it("detects Ollama endpoints by fingerprint", async () => {
    const result = await discoverApiEndpoints("http://localhost:11434/api");
    expect(result.detectedService).toBe("Ollama Local LLM");
    expect(result.endpoints.some((e) => e.path === "/api/tags")).toBe(true);
    expect(result.endpoints.some((e) => e.path === "/api/generate")).toBe(true);
  });

  it("discovers active routes like /products and /users via probing", async () => {
    const result = await discoverApiEndpoints("https://dummyjson.com");
    expect(result.endpoints.some((e) => e.path === "/products" && e.status === 200)).toBe(true);
    expect(result.endpoints.some((e) => e.path === "/users" && e.status === 200)).toBe(true);
  });
});
