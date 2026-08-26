import { describe, expect, it } from "vitest";
import {
  MAX_SIGNATURES,
  normalizeSignatureHelp,
} from "./signatureHelp";

describe("LSP signature help", () => {
  it("normalizes active overload, parameter ranges and documentation", () => {
    const help = normalizeSignatureHelp({
      activeSignature: 1,
      activeParameter: 1,
      signatures: [
        { label: "sum(a: number): number" },
        {
          label: "sum(a: number, b: number): number",
          documentation: { kind: "markdown", value: "Adds two values." },
          parameters: [
            { label: [4, 13], documentation: "First value" },
            { label: "b: number", documentation: { value: "Second value" } },
          ],
        },
      ],
    });

    expect(help).toMatchObject({ activeSignature: 1 });
    expect(help?.signatures[1]).toMatchObject({
      label: "sum(a: number, b: number): number",
      documentation: "Adds two values.",
      activeParameter: 1,
    });
    expect(help?.signatures[1].parameters).toEqual([
      {
        label: "a: number",
        start: 4,
        end: 13,
        documentation: "First value",
      },
      {
        label: "b: number",
        start: 15,
        end: 24,
        documentation: "Second value",
      },
    ]);
  });

  it("clamps indices, rejects malformed payloads and caps overloads", () => {
    expect(normalizeSignatureHelp({ signatures: [] })).toBeNull();
    expect(normalizeSignatureHelp({ signatures: [{ label: "" }] })).toBeNull();

    const help = normalizeSignatureHelp({
      activeSignature: 999,
      signatures: Array.from({ length: MAX_SIGNATURES + 5 }, (_, index) => ({
        label: `fn${index}()` ,
      })),
    });
    expect(help?.signatures).toHaveLength(MAX_SIGNATURES);
    expect(help?.activeSignature).toBe(MAX_SIGNATURES - 1);
  });
});
