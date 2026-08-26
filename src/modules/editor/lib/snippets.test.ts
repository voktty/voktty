import { describe, expect, it } from "vitest";
import { applySnippetIndent, snippetsForLanguage } from "./snippets";

describe("snippetsForLanguage", () => {
  it("returns typed language snippets with navigable placeholders", () => {
    const snippets = snippetsForLanguage("typescript");
    expect(snippets.some((entry) => entry.prefix === "function")).toBe(true);
    expect(snippets.every((entry) => entry.template.includes("${"))).toBe(true);
  });

  it("shares web snippets across language aliases", () => {
    expect(snippetsForLanguage("tsx").map((entry) => entry.prefix)).toContain(
      "component",
    );
    expect(
      snippetsForLanguage("javascript").map((entry) => entry.prefix),
    ).toContain("function");
  });

  it("provides PHP block and return snippets without an LSP", () => {
    const prefixes = snippetsForLanguage("php").map((entry) => entry.prefix);
    expect(prefixes).toEqual(
      expect.arrayContaining(["function", "if", "foreach", "class", "return"]),
    );
  });

  it("returns no snippets for plain text", () => {
    expect(snippetsForLanguage("text")).toEqual([]);
  });

  it("adapts snippet indentation to the active editor unit", () => {
    expect(applySnippetIndent("if true {\n\tvalue\n}", "  ")).toBe(
      "if true {\n  value\n}",
    );
  });
});
