import { describe, expect, it } from "vitest";
import { cleanCodeFences, extractFileMentions } from "./inlineEditService";

describe("cleanCodeFences", () => {
  it("removes triple backticks with language tags", () => {
    const raw = "```typescript\nconst a: number = 42;\nconsole.log(a);\n```";
    expect(cleanCodeFences(raw)).toBe("const a: number = 42;\nconsole.log(a);");
  });

  it("removes generic triple backticks", () => {
    const raw = "```\nconst x = true;\n```";
    expect(cleanCodeFences(raw)).toBe("const x = true;");
  });

  it("leaves unwrapped raw code untouched", () => {
    const raw = "function add(a: number, b: number) {\n  return a + b;\n}";
    expect(cleanCodeFences(raw)).toBe(raw);
  });
});

describe("extractFileMentions", () => {
  it("extracts multiple unique @file.ext references", () => {
    const prompt = "Use helper from @src/lib/calc.ts and also check @config.json and @src/lib/calc.ts";
    const mentions = extractFileMentions(prompt);
    expect(mentions).toEqual(["src/lib/calc.ts", "config.json"]);
  });

  it("returns empty array if no mentions", () => {
    expect(extractFileMentions("Refactor this code cleanly")).toEqual([]);
  });
});
