import { describe, expect, it } from "vitest";
import {
  normalizeSemanticTokens,
  semanticTokenLegend,
  semanticTokenOffsets,
} from "./semanticTokens";

const legend = {
  tokenTypes: ["namespace", "type", "function", "variable"],
  tokenModifiers: ["declaration", "readonly", "static"],
};

describe("normalizeSemanticTokens", () => {
  it("accepts only full semantic-token providers with a valid legend", () => {
    expect(
      semanticTokenLegend({
        semanticTokensProvider: { legend, full: { delta: true } },
      }),
    ).toEqual(legend);
    expect(
      semanticTokenLegend({
        semanticTokensProvider: { legend, full: false },
      }),
    ).toBeNull();
    expect(semanticTokenLegend({ semanticTokensProvider: true })).toBeNull();
  });

  it("decodes delta positions, token types and modifier bits", () => {
    expect(
      normalizeSemanticTokens(
        {
          data: [0, 2, 4, 2, 1, 0, 7, 3, 3, 2, 2, 1, 5, 1, 0],
        },
        legend,
      ),
    ).toEqual({
      tokens: [
        {
          line: 0,
          character: 2,
          length: 4,
          type: "function",
          modifiers: ["declaration"],
        },
        {
          line: 0,
          character: 9,
          length: 3,
          type: "variable",
          modifiers: ["readonly"],
        },
        {
          line: 2,
          character: 1,
          length: 5,
          type: "type",
          modifiers: [],
        },
      ],
      truncated: false,
    });
  });

  it("rejects malformed payloads and invalid legends", () => {
    expect(normalizeSemanticTokens({ data: [0, 0] }, legend)).toBeNull();
    expect(
      normalizeSemanticTokens({ data: [0, -1, 2, 0, 0] }, legend),
    ).toBeNull();
    expect(
      normalizeSemanticTokens({ data: [0, 0, 2, 8, 0] }, legend),
    ).toBeNull();
    expect(
      normalizeSemanticTokens(
        { data: [0, 0, 2, 0, 0] },
        { tokenTypes: [], tokenModifiers: [] },
      ),
    ).toBeNull();
  });

  it("caps decoded tokens without losing delta decoding", () => {
    const result = normalizeSemanticTokens(
      { data: [0, 0, 1, 0, 0, 0, 2, 1, 1, 0, 1, 1, 1, 2, 0] },
      legend,
      2,
    );
    expect(result?.tokens).toHaveLength(2);
    expect(result?.truncated).toBe(true);
  });

  it("maps UTF-16 positions to valid document offsets", () => {
    expect(
      semanticTokenOffsets("😀name\nnext", [
        {
          line: 0,
          character: 2,
          length: 4,
          type: "variable",
          modifiers: [],
        },
        {
          line: 0,
          character: 1,
          length: 2,
          type: "type",
          modifiers: [],
        },
        {
          line: 4,
          character: 0,
          length: 1,
          type: "type",
          modifiers: [],
        },
      ]),
    ).toEqual([
      {
        from: 2,
        to: 6,
        type: "variable",
        modifiers: [],
      },
    ]);
  });
});
