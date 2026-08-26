import { describe, expect, it } from "vitest";
import { buildUserPrompt, trimContext } from "./prompt";

describe("trimContext", () => {
  it("leaves short prefix and suffix unchanged", () => {
    expect(trimContext("abc", "xyz")).toEqual({ prefix: "abc", suffix: "xyz" });
  });

  it("keeps the tail of an over-long prefix (nearest the cursor)", () => {
    const prefix = `${"x".repeat(5000)}TAIL`;
    const { prefix: out } = trimContext(prefix, "");
    expect(out).toHaveLength(4000);
    expect(out.endsWith("TAIL")).toBe(true);
  });

  it("keeps the head of an over-long suffix (nearest the cursor)", () => {
    const suffix = `HEAD${"y".repeat(5000)}`;
    const { suffix: out } = trimContext("", suffix);
    expect(out).toHaveLength(2000);
    expect(out.startsWith("HEAD")).toBe(true);
  });
});

describe("buildUserPrompt", () => {
  it("wraps prefix and suffix in fenced blocks", () => {
    const prompt = buildUserPrompt({
      prefix: "foo",
      suffix: "bar",
      filename: null,
      language: null,
      indentUnit: null,
    });
    expect(prompt).toContain("PREFIX:\n<<<\nfoo\n>>>");
    expect(prompt).toContain("SUFFIX:\n<<<\nbar\n>>>");
  });

  it("omits the metadata block when no metadata is provided", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: null,
      language: null,
      indentUnit: null,
    });
    expect(prompt.startsWith("PREFIX:")).toBe(true);
  });

  it("includes file, language, and space-indent metadata", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: "a.ts",
      language: "typescript",
      indentUnit: "  ",
    });
    expect(prompt).toContain("File: a.ts");
    expect(prompt).toContain("Language: typescript");
    expect(prompt).toContain("Indent: 2 spaces");
  });

  it("labels a tab indent unit as tabs", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: null,
      language: null,
      indentUnit: "\t",
    });
    expect(prompt).toContain("Indent: tabs");
  });

  it("includes bounded structural context for the autocomplete model", () => {
    const prompt = buildUserPrompt({
      prefix: "function total() {\n  ",
      suffix: "\n}",
      filename: "total.ts",
      language: "typescript",
      indentUnit: "  ",
      context: {
        currentBlock: "function total() {\n  \n}",
        neighborBefore: "const tax = 0.2;",
        neighborAfter: "export { total };",
        symbols: ["function total (line 2)"],
        diagnostics: ["error line 3: A value is required"],
      },
    });

    expect(prompt).toContain("CURRENT LOGICAL BLOCK:");
    expect(prompt).toContain("function total (line 2)");
    expect(prompt).toContain("error line 3: A value is required");
  });

  it("truncates the embedded context to the trim limits", () => {
    const prompt = buildUserPrompt({
      prefix: "p".repeat(5000),
      suffix: "s".repeat(5000),
      filename: null,
      language: null,
      indentUnit: null,
    });
    expect(prompt).toContain("p".repeat(4000));
    expect(prompt).not.toContain("p".repeat(4001));
    expect(prompt).toContain("s".repeat(2000));
    expect(prompt).not.toContain("s".repeat(2001));
  });
});
