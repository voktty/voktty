import { describe, expect, it } from "vitest";
import {
  inlayHintOffsets,
  normalizeInlayHints,
  supportsInlayHints,
} from "./inlayHints";

describe("normalizeInlayHints", () => {
  it("recognizes boolean and object server capabilities", () => {
    expect(supportsInlayHints({ inlayHintProvider: true })).toBe(true);
    expect(
      supportsInlayHints({ inlayHintProvider: { resolveProvider: true } }),
    ).toBe(true);
    expect(supportsInlayHints({ inlayHintProvider: false })).toBe(false);
  });

  it("normalizes string and label-part hints as plain bounded text", () => {
    expect(
      normalizeInlayHints([
        {
          position: { line: 3, character: 8 },
          label: ": number",
          kind: 1,
          paddingLeft: true,
          tooltip: { kind: "markdown", value: "Resolved type" },
        },
        {
          position: { line: 1, character: 4 },
          label: [{ value: "name" }, { value: ": " }, { value: "string" }],
          kind: 2,
          paddingRight: true,
        },
      ]),
    ).toEqual({
      hints: [
        {
          line: 1,
          character: 4,
          label: "name: string",
          kind: "parameter",
          paddingLeft: false,
          paddingRight: true,
          tooltip: null,
        },
        {
          line: 3,
          character: 8,
          label: ": number",
          kind: "type",
          paddingLeft: true,
          paddingRight: false,
          tooltip: "Resolved type",
        },
      ],
      truncated: false,
    });
  });

  it("drops malformed, empty and duplicate hints", () => {
    expect(
      normalizeInlayHints([
        null,
        { position: { line: -1, character: 0 }, label: "bad" },
        { position: { line: 0, character: 0 }, label: "" },
        { position: { line: 0, character: 2 }, label: "value" },
        { position: { line: 0, character: 2 }, label: "value" },
      ]).hints,
    ).toEqual([
      {
        line: 0,
        character: 2,
        label: "value",
        kind: null,
        paddingLeft: false,
        paddingRight: false,
        tooltip: null,
      },
    ]);
  });

  it("caps visible hints and reports truncation", () => {
    const result = normalizeInlayHints(
      Array.from({ length: 4 }, (_, character) => ({
        position: { line: 0, character },
        label: `hint${character}`,
      })),
      2,
    );
    expect(result.hints).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("maps UTF-16 hint positions and rejects surrogate splits", () => {
    expect(
      inlayHintOffsets("😀call()\n", [
        {
          line: 0,
          character: 2,
          label: "parameter:",
          kind: "parameter",
          paddingLeft: false,
          paddingRight: true,
          tooltip: null,
        },
        {
          line: 0,
          character: 1,
          label: "bad",
          kind: null,
          paddingLeft: false,
          paddingRight: false,
          tooltip: null,
        },
      ]),
    ).toEqual([
      {
        offset: 2,
        label: "parameter:",
        kind: "parameter",
        paddingLeft: false,
        paddingRight: true,
        tooltip: null,
      },
    ]);
  });
});
