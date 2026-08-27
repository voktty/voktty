import { describe, expect, it } from "vitest";
import { generateCurlCommand, generateJsFetch, generatePythonRequests, parseCurlCommand } from "./curlParser";
import type { ApiRequest } from "../types";

describe("curlParser", () => {
  it("parses simple GET curl command", () => {
    const curl = "curl https://api.example.com/users";
    const req = parseCurlCommand(curl);
    expect(req).toBeDefined();
    expect(req?.method).toBe("GET");
    expect(req?.url).toBe("https://api.example.com/users");
  });

  it("parses POST curl with headers and json body", () => {
    const curl = `curl -X POST https://api.example.com/checkout \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer secret_123" \\
      -d '{"amount": 2500, "currency": "usd"}'`;

    const req = parseCurlCommand(curl);
    expect(req).toBeDefined();
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://api.example.com/checkout");
    expect(req?.authType).toBe("bearer");
    expect(req?.bearerToken).toBe("secret_123");
    expect(req?.bodyType).toBe("json");
    expect(req?.bodyContent).toContain('"amount": 2500');
  });

  it("generates valid cURL, JS fetch, and Python requests", () => {
    const req: ApiRequest = {
      id: "test-req",
      name: "Test Request",
      url: "https://api.stripe.com/v1/charges",
      method: "POST",
      headers: [
        { key: "Content-Type", value: "application/json", enabled: true },
      ],
      queryParams: [{ key: "limit", value: "10", enabled: true }],
      authType: "bearer",
      bearerToken: "sk_test_mock",
      bodyType: "json",
      bodyContent: JSON.stringify({ amount: 1000 }),
    };

    const curl = generateCurlCommand(req);
    expect(curl).toContain("curl -X POST");
    expect(curl).toContain("https://api.stripe.com/v1/charges?limit=10");
    expect(curl).toContain("Authorization: Bearer sk_test_mock");

    const js = generateJsFetch(req);
    expect(js).toContain('fetch("https://api.stripe.com/v1/charges?limit=10"');
    expect(js).toContain('"method": "POST"');

    const py = generatePythonRequests(req);
    expect(py).toContain("import requests");
    expect(py).toContain("requests.post(");
  });
});
