import { describe, expect, it } from "vitest";
import { isLocalUrl, isLoopbackHost } from "./urlSafety";

describe("isLocalUrl", () => {
  it("accepts loopback http and https origins", () => {
    expect(isLocalUrl("http://localhost:5173/app")).toBe(true);
    expect(isLocalUrl("https://127.0.0.1:3000")).toBe(true);
    expect(isLocalUrl("http://0.0.0.0:8080")).toBe(true);
    expect(isLocalUrl("http://[::1]:3000")).toBe(true);
    expect(isLocalUrl("http://app.localhost/")).toBe(true);
  });

  it("rejects non-loopback and non-http urls", () => {
    expect(isLocalUrl("https://example.com")).toBe(false);
    expect(isLocalUrl("file:///C:/tmp/index.html")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("treats bracketed ipv6 loopback as local", () => {
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });
});
