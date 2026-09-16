import { describe, expect, it } from "vitest";
import { getOpenCodeTextResponse } from "./opencodeText";

describe("getOpenCodeTextResponse", () => {
  it("extracts and joins text from multiple text parts", () => {
    const parts = [
      { type: "text", text: "Hello " },
      { type: "other", text: "ignored" },
      { type: "text", text: "World!" },
    ];
    expect(getOpenCodeTextResponse(parts)).toBe("Hello World!");
  });

  it("handles empty or malformed parts gracefully", () => {
    expect(getOpenCodeTextResponse(undefined)).toBe("");
    expect(getOpenCodeTextResponse([])).toBe("");
    expect(getOpenCodeTextResponse([null, undefined, {}, { type: "image" }])).toBe(
      "",
    );
  });
});
