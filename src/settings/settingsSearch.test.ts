import { describe, expect, it } from "vitest";
import { searchSettings } from "./settingsSearch";

const translations: Record<string, string> = {
  "settings.general.terminal.fontSizeTitle": "Tamaño de fuente",
  "settings.general.terminal.fontSizeDesc": "Texto de terminal en píxeles.",
  "settings.general.terminal.shellTitle": "Shell predeterminado",
  "settings.general.terminal.shellDesc": "Shell para nuevas pestañas de terminal.",
  "settings.editor.display.fontSizeTitle": "Tamaño de fuente",
  "settings.editor.display.fontSizeDesc": "Tamaño del texto del editor.",
  "settings.tabs.general": "General",
  "settings.general.description": "Terminal y arranque.",
};

const translate = (key: string) => translations[key] ?? "";

describe("searchSettings", () => {
  it("returns no entries for an empty query", () => {
    expect(searchSettings("", translate)).toEqual([]);
  });

  it("matches titles and descriptions without accents", () => {
    const results = searchSettings("tamano editor", translate);

    expect(results.map((result) => result.id)).toContain("editor-font-size");
    expect(results.map((result) => result.id)).not.toContain("general-terminal-font-size");
  });

  it("requires every query token to match", () => {
    const results = searchSettings("terminal shell", translate);

    expect(results.map((result) => result.id)).toEqual(["general-terminal-shell"]);
  });

  it("returns an empty list for unknown settings", () => {
    expect(searchSettings("not-a-setting", translate)).toEqual([]);
  });
});
