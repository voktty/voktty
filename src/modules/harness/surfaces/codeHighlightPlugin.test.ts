import type { HighlightResult } from "@streamdown/code";
import type { BundledLanguage } from "shiki";
import { describe, expect, it } from "vitest";
import {
  createBoundedCodePlugin,
  type BoundedCodePlugin,
} from "./codeHighlightPlugin";

function highlight(
  plugin: BoundedCodePlugin,
  code: string,
  language = "ts",
): Promise<HighlightResult> {
  return new Promise((resolve) => {
    const cached = plugin.highlight(
      {
        code,
        language: language as BundledLanguage,
        themes: plugin.getThemes(),
      },
      resolve,
    );
    if (cached) resolve(cached);
  });
}

function text(result: HighlightResult): string {
  return result.tokens
    .map((line) => line.map((token) => token.content).join(""))
    .join("\n");
}

describe("bounded code highlight plugin", () => {
  it("keeps the cache bounded while a fence streams in", async () => {
    const plugin = createBoundedCodePlugin({ maxEntries: 8 });
    const source = Array.from(
      { length: 40 },
      (_, i) => `const value${i} = ${i};`,
    ).join("\n");
    // Streamdown highlights again on every update of an open fence.
    for (let end = 20; end <= source.length; end += 20) {
      await highlight(plugin, source.slice(0, end));
    }
    expect(plugin.cachedResults()).toBeLessThanOrEqual(8);
    expect(text(await highlight(plugin, source))).toBe(source);
  }, 20_000);

  it("caps the cached source size", async () => {
    const plugin = createBoundedCodePlugin({ maxChars: 2_000 });
    for (let i = 0; i < 5; i += 1) {
      await highlight(plugin, `// block ${i}\n${"x".repeat(900)}`);
    }
    expect(plugin.cachedResults()).toBe(2);
  }, 20_000);

  it("delivers but does not cache a block larger than the budget", async () => {
    const plugin = createBoundedCodePlugin({ maxChars: 500 });
    const huge = `// big\n${"y".repeat(1_000)}`;
    expect(text(await highlight(plugin, huge))).toBe(huge);
    expect(plugin.cachedResults()).toBe(0);
  }, 20_000);

  it("returns cached tokens synchronously and keeps distinct blocks apart", async () => {
    const plugin = createBoundedCodePlugin();
    const head = "const a = 1;\n".repeat(10);
    const tail = "\nconst z = 26;".repeat(10);
    const first = `${head}let middle = "one";${tail}`;
    const second = `${head}let middle = "two";${tail}`;
    expect(first.length).toBe(second.length);

    expect(text(await highlight(plugin, first))).toBe(first);
    expect(text(await highlight(plugin, second))).toBe(second);
    const again = plugin.highlight(
      {
        code: first,
        language: "ts" as BundledLanguage,
        themes: plugin.getThemes(),
      },
      () => undefined,
    );
    expect(again && text(again)).toBe(first);
  }, 20_000);

  it("colors code and falls back to plain text for unknown languages", async () => {
    const plugin = createBoundedCodePlugin();
    const colored = await highlight(plugin, "const x = 1;", "typescript");
    const colors = new Set(
      colored.tokens
        .flat()
        .map((token) => token.htmlStyle?.color ?? token.color),
    );
    expect(colors.size).toBeGreaterThan(1);
    const plain = await highlight(plugin, "anything", "not-a-language");
    expect(text(plain)).toBe("anything");
  }, 20_000);
});
