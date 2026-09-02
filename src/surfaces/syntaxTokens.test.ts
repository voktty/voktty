import { javascript } from "@codemirror/lang-javascript";
import { describe, expect, it } from "vitest";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import {
  highlightDiffFile,
  highlightSource,
} from "./syntaxTokens";

const KEYWORD_DARK = "#ff8ffd";
const STRING_DARK = "#b4fa72";
const COMMENT_DARK = "#fefdc2";

describe("highlightSource", () => {
  it("colors TypeScript keywords, strings, and comments", () => {
    const lines = highlightSource(
      'const name = "agent";\n// note',
      javascript({ typescript: true }),
      "dark",
    );
    expect(token(lines[0], "const")?.color).toBe(KEYWORD_DARK);
    expect(token(lines[0], '"agent"')?.color).toBe(STRING_DARK);
    expect(token(lines[1], "// note")?.color).toBe(COMMENT_DARK);
  });

  it("leaves unknown languages unstyled", () => {
    const lines = highlightSource("plain text", null, "dark");
    expect(lines).toEqual([[{ text: "plain text" }]]);
  });
});

describe("highlightDiffFile", () => {
  it("highlights added and deleted lines from each side", async () => {
    const diff = buildUnifiedFile(
      "const alpha = 1;\n",
      "const beta = 1;\n",
    );
    const tokens = await highlightDiffFile(
      {
        path: "src/lib/settings.ts",
        blocks: diff.blocks,
      },
      "dark",
    );
    const deleted = diff.lines.find((line) => line.kind === "del");
    const added = diff.lines.find((line) => line.kind === "add");
    expect(deleted && token(tokens.get(deleted), "const")?.color).toBe(
      KEYWORD_DARK,
    );
    expect(added && token(tokens.get(added), "const")?.color).toBe(
      KEYWORD_DARK,
    );
  });
});

function token(line: { text: string; color?: string }[] | undefined, text: string) {
  return line?.find((piece) => piece.text.includes(text) || piece.text === text);
}
