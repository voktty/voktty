import { describe, expect, it } from "vitest";
import { buildCompletionContext } from "./completionContext";

describe("buildCompletionContext", () => {
  it("keeps the current logical block and bounded neighboring code", () => {
    const prefix = Array.from({ length: 120 }, (_, index) => `const before${index} = ${index};`).join("\n");
    const block = "function total(values: number[]) {\n  return values.reduce((sum, value) => sum + value, 0);\n}";
    const suffix = Array.from({ length: 120 }, (_, index) => `const after${index} = ${index};`).join("\n");
    const content = `${prefix}\n${block}\n${suffix}`;
    const cursor = content.indexOf("values.reduce") + 8;

    const context = buildCompletionContext({
      content,
      cursor,
      symbols: [{ name: "total", kind: "function", line: 121 }],
      diagnostics: [{ severity: "error", message: "Expected a number", line: 122 }],
    });

    expect(context.currentBlock).toContain("function total");
    expect(context.currentBlock).toContain("values.reduce");
    expect(context.neighborBefore).not.toContain("before0");
    expect(context.neighborAfter).not.toContain("after119");
    expect(context.symbols).toEqual(["function total (line 121)"]);
    expect(context.diagnostics).toEqual(["error line 122: Expected a number"]);
  });

  it("caps untrusted metadata and normalizes the cursor", () => {
    const context = buildCompletionContext({
      content: "const value = 1;",
      cursor: 99,
      symbols: Array.from({ length: 30 }, (_, index) => ({
        name: `symbol-${index}-${"x".repeat(200)}`,
        kind: "variable",
        line: index + 1,
      })),
      diagnostics: Array.from({ length: 20 }, (_, index) => ({
        severity: "warning",
        message: `warning-${index}-${"y".repeat(300)}`,
        line: index + 1,
      })),
    });

    expect(context.symbols).toHaveLength(12);
    expect(context.diagnostics).toHaveLength(6);
    expect(context.symbols.every((entry) => entry.length <= 180)).toBe(true);
    expect(context.diagnostics.every((entry) => entry.length <= 240)).toBe(true);
  });
});
