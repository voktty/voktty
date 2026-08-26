import { describe, expect, it } from "vitest";
import { lspLocationLabel, normalizeLspLocations } from "./locations";

describe("normalizeLspLocations", () => {
  it("normalizes locations and location links", () => {
    expect(
      normalizeLspLocations([
        {
          uri: "file:///workspace/a.ts",
          range: { start: { line: 2, character: 4 } },
        },
        {
          targetUri: "file:///workspace/b.ts",
          targetRange: { start: { line: 8, character: 1 } },
          targetSelectionRange: { start: { line: 7, character: 3 } },
        },
      ]),
    ).toEqual({
      locations: [
        {
          uri: "file:///workspace/a.ts",
          range: { start: { line: 2, character: 4 } },
        },
        {
          uri: "file:///workspace/b.ts",
          range: { start: { line: 7, character: 3 } },
        },
      ],
      truncated: false,
    });
  });

  it("rejects malformed locations without discarding valid siblings", () => {
    expect(
      normalizeLspLocations([
        null,
        { uri: "", range: { start: { line: 0, character: 0 } } },
        {
          uri: "file:///workspace/a.ts",
          range: { start: { line: -1, character: 0 } },
        },
        {
          uri: "file:///workspace/good.ts",
          range: { start: { line: 1, character: 2 } },
        },
      ]).locations,
    ).toEqual([
      {
        uri: "file:///workspace/good.ts",
        range: { start: { line: 1, character: 2 } },
      },
    ]);
  });

  it("deduplicates exact positions and enforces the result cap", () => {
    const location = {
      uri: "file:///workspace/a.ts",
      range: { start: { line: 0, character: 0 } },
    };
    const result = normalizeLspLocations(
      [
        location,
        location,
        ...Array.from({ length: 5 }, (_, line) => ({
          uri: "file:///workspace/b.ts",
          range: { start: { line, character: 0 } },
        })),
      ],
      3,
    );
    expect(result.locations).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("formats relative labels for Windows and Unix roots", () => {
    expect(
      lspLocationLabel(
        "C:\\Work\\voktty\\src\\main.ts",
        "c:/work/voktty",
        4,
        2,
      ),
    ).toBe("src/main.ts:5:3");
    expect(lspLocationLabel("/src/main.ts", "/", 0, 0)).toBe("src/main.ts:1:1");
  });
});
