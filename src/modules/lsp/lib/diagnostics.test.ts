import { describe, expect, it } from "vitest";
import { readPublishedDiagnostics } from "./diagnostics";

describe("LSP diagnostic notifications", () => {
  it("accepts publishDiagnostics notifications", () => {
    const result = readPublishedDiagnostics({
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///repo/main.ts",
        diagnostics: [{ message: "Broken" }],
        version: 3,
      },
    });

    expect(result).toEqual({
      uri: "file:///repo/main.ts",
      diagnostics: [{ message: "Broken" }],
    });
  });

  it("ignores unrelated or malformed notifications", () => {
    expect(
      readPublishedDiagnostics({ method: "window/logMessage", params: {} }),
    ).toBeNull();
    expect(
      readPublishedDiagnostics({
        method: "textDocument/publishDiagnostics",
        params: { uri: 42, diagnostics: null },
      }),
    ).toBeNull();
  });
});
