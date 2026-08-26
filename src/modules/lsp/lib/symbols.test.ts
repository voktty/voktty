import { describe, expect, it } from "vitest";
import { normalizeDocumentSymbols, normalizeWorkspaceSymbols } from "./symbols";

describe("LSP symbols", () => {
  it("preserves document hierarchy and selection positions", () => {
    const symbols = normalizeDocumentSymbols(
      [
        {
          name: "Greeter",
          detail: "class",
          kind: 5,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 8, character: 1 },
          },
          selectionRange: {
            start: { line: 1, character: 6 },
            end: { line: 1, character: 13 },
          },
          children: [
            {
              name: "greet",
              kind: 6,
              range: {
                start: { line: 3, character: 2 },
                end: { line: 5, character: 3 },
              },
              selectionRange: {
                start: { line: 3, character: 2 },
                end: { line: 3, character: 7 },
              },
            },
          ],
        },
      ],
      "C:/project/greeter.ts",
    );

    expect(symbols).toMatchObject([
      {
        name: "Greeter",
        path: "C:/project/greeter.ts",
        line: 2,
        column: 7,
        children: [{ name: "greet", line: 4, column: 3 }],
      },
    ]);
  });

  it("normalizes flat document SymbolInformation results", () => {
    const symbols = normalizeDocumentSymbols(
      [
        {
          name: "run",
          kind: 12,
          containerName: "main",
          location: {
            uri: "file:///C:/project/main.ts",
            range: {
              start: { line: 4, character: 2 },
              end: { line: 4, character: 5 },
            },
          },
        },
      ],
      "C:/project/main.ts",
    );

    expect(symbols[0]).toMatchObject({
      name: "run",
      detail: "main",
      path: "C:/project/main.ts",
      line: 5,
      column: 3,
    });
  });

  it("drops workspace symbols without a concrete range and caps results", () => {
    const raw = Array.from({ length: 510 }, (_, index) => ({
      name: `symbol${index}`,
      kind: 12,
      location: {
        uri: "file:///C:/project/main.ts",
        ...(index === 0
          ? {}
          : {
              range: {
                start: { line: index, character: 0 },
                end: { line: index, character: 1 },
              },
            }),
      },
    }));

    const symbols = normalizeWorkspaceSymbols(raw);
    expect(symbols).toHaveLength(500);
    expect(symbols[0].name).toBe("symbol1");
  });
});
