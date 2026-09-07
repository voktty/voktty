import { describe, expect, it } from "vitest";
import { targetOriginFor } from "./inspectorBridge";

describe("targetOriginFor", () => {
  it("reads the origin from an absolute http iframe src", () => {
    expect(
      targetOriginFor({ src: "http://localhost:5173/app?x=1" }),
    ).toBe("http://localhost:5173");
  });

  it("reads the origin from an https iframe src", () => {
    expect(
      targetOriginFor({ src: "https://tauri.localhost/preview" }),
    ).toBe("https://tauri.localhost");
  });

  it("returns null for an empty src", () => {
    expect(targetOriginFor({ src: "" })).toBeNull();
    expect(targetOriginFor({ src: "   " })).toBeNull();
  });

  it("returns null for opaque and non-http schemes", () => {
    expect(targetOriginFor({ src: "about:blank" })).toBeNull();
    expect(targetOriginFor({ src: "blob:http://localhost:3000/abc" })).toBeNull();
    expect(targetOriginFor({ src: "file:///C:/tmp/index.html" })).toBeNull();
  });

  it("returns null for an unparseable src", () => {
    expect(targetOriginFor({ src: "http://[not-a-url" })).toBeNull();
  });
});
