import { describe, expect, it } from "vitest";
import { parsePostmanCollection } from "./postmanParser";

describe("parsePostmanCollection", () => {
  it("parses valid Postman v2.1 collection with folders, headers, auth and body", () => {
    const postmanJson = JSON.stringify({
      info: {
        name: "Test API Collection",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: [
        {
          name: "Auth Folder",
          item: [
            {
              name: "Login Request",
              request: {
                method: "POST",
                url: {
                  raw: "https://api.example.com/v1/login?ref=cli",
                  query: [{ key: "ref", value: "cli" }],
                },
                header: [{ key: "Content-Type", value: "application/json" }],
                body: {
                  mode: "raw",
                  raw: '{"username":"test","password":"secret"}',
                  options: { raw: { language: "json" } },
                },
              },
            },
          ],
        },
        {
          name: "Get Profile",
          request: {
            method: "GET",
            url: "https://api.example.com/v1/profile",
            auth: {
              type: "bearer",
              bearer: [{ key: "token", value: "my-bearer-token" }],
            },
          },
        },
      ],
    });

    const result = parsePostmanCollection(postmanJson);
    expect(result.collectionName).toBe("Test API Collection");
    expect(result.requests).toHaveLength(2);

    const loginReq = result.requests[0];
    expect(loginReq.name).toBe("Auth Folder / Login Request");
    expect(loginReq.method).toBe("POST");
    expect(loginReq.url).toBe("https://api.example.com/v1/login?ref=cli");
    expect(loginReq.bodyType).toBe("json");
    expect(loginReq.bodyContent).toContain('"username":"test"');

    const profileReq = result.requests[1];
    expect(profileReq.name).toBe("Get Profile");
    expect(profileReq.method).toBe("GET");
    expect(profileReq.authType).toBe("bearer");
    expect(profileReq.bearerToken).toBe("my-bearer-token");
  });

  it("handles malformed JSON gracefully", () => {
    const result = parsePostmanCollection("{ invalid json");
    expect(result.error).toBeDefined();
    expect(result.requests).toHaveLength(0);
  });
});
