import { describe, expect, it } from "vitest";
import { getLanguageSelectionActions, isLogicalCodeBlock } from "./selectionActions";

describe("getLanguageSelectionActions", () => {
  it("returns PHP tailored actions for php files", () => {
    const res = getLanguageSelectionActions("index.php");
    expect(res.languageName).toBe("PHP");
    expect(res.actions.some((a) => a.id === "php-security")).toBe(true);
    expect(res.actions.some((a) => a.id === "php-optimize")).toBe(true);
    expect(res.actions.some((a) => a.id === "php-fix")).toBe(true);
  });

  it("returns HTML / Markup actions for html files", () => {
    const res = getLanguageSelectionActions("index.html");
    expect(res.languageName).toBe("HTML");
    expect(res.actions.some((a) => a.id === "html-tailwind")).toBe(true);
    expect(res.actions.some((a) => a.id === "html-a11y")).toBe(true);
  });

  it("returns TypeScript actions for ts/tsx files", () => {
    const res = getLanguageSelectionActions("src/app/App.tsx");
    expect(res.languageName).toBe("TypeScript");
    expect(res.actions.some((a) => a.id === "ts-strict-types")).toBe(true);
    expect(res.actions.some((a) => a.id === "ts-tests")).toBe(true);
  });

  it("returns Python actions for py files", () => {
    const res = getLanguageSelectionActions("script.py");
    expect(res.languageName).toBe("Python");
    expect(res.actions.some((a) => a.id === "py-pythonic")).toBe(true);
    expect(res.actions.some((a) => a.id === "py-pytest")).toBe(true);
  });

  it("returns Text/Markdown actions for txt/md files", () => {
    const res = getLanguageSelectionActions("notes.txt");
    expect(res.languageName).toBe("Text");
    expect(res.actions.some((a) => a.id === "text-improve")).toBe(true);
    expect(res.actions.some((a) => a.id === "text-translate")).toBe(true);
  });

  it("falls back to generic code actions for unknown extensions", () => {
    const res = getLanguageSelectionActions("unknown.xyz");
    expect(res.actions.length).toBeGreaterThan(0);
    expect(res.actions.some((a) => a.id === "generic-optimize")).toBe(true);
  });
});

describe("isLogicalCodeBlock", () => {
  it("rejects empty or very short strings", () => {
    expect(isLogicalCodeBlock("")).toBe(false);
    expect(isLogicalCodeBlock("   ")).toBe(false);
    expect(isLogicalCodeBlock("card")).toBe(false);
    expect(isLogicalCodeBlock("margin: 0;")).toBe(false);
  });

  it("accepts multiline code blocks", () => {
    const cssBlock = `.card {\n  background: #fff;\n  padding: 3rem;\n}`;
    expect(isLogicalCodeBlock(cssBlock)).toBe(true);

    const jsFunction = `function test() {\n  return 42;\n}`;
    expect(isLogicalCodeBlock(jsFunction)).toBe(true);
  });

  it("accepts complete single line statements with balanced delimiters", () => {
    const htmlTag = `<button class="btn">Click me</button>`;
    expect(isLogicalCodeBlock(htmlTag)).toBe(true);

    const callStatement = `console.log("Hello world from app");`;
    expect(isLogicalCodeBlock(callStatement)).toBe(true);
  });
});
