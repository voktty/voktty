import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE_EDITOR_SOURCE = readFileSync(
  fileURLToPath(new URL("./FileEditor.tsx", import.meta.url)),
  "utf8",
);
const EDITOR_CHROME_SOURCE = readFileSync(
  fileURLToPath(new URL("./editorChrome.ts", import.meta.url)),
  "utf8",
);
const TERMINAL_VIEW_SOURCE = readFileSync(
  fileURLToPath(new URL("./TerminalView.tsx", import.meta.url)),
  "utf8",
);

describe("Harness embedded theme contract", () => {
  it("resolves CodeMirror through the same global editor theme hook", () => {
    expect(FILE_EDITOR_SOURCE).toContain(
      'import { useEditorThemeExt } from "@/modules/editor/editorTheme"',
    );
    expect(FILE_EDITOR_SOURCE).toContain(
      "const globalEditorTheme = useEditorThemeExt()",
    );
    expect(FILE_EDITOR_SOURCE).toContain(
      "themedEditorExtensions(globalEditorTheme, colorScheme)",
    );
    expect(EDITOR_CHROME_SOURCE).not.toContain("syntaxHighlighting(");
  });

  it("updates xterm from global terminal tokens without recreating the PTY", () => {
    expect(TERMINAL_VIEW_SOURCE).toContain("THEME_CHANGED_EVENT");
    expect(TERMINAL_VIEW_SOURCE).toContain(
      "term.options.theme = buildTerminalTheme()",
    );
    expect(TERMINAL_VIEW_SOURCE).toMatch(
      /const onSchemeChange = \(\) => \{\s*term\.options\.theme = buildTerminalTheme\(\);\s*\}/,
    );
  });
});
