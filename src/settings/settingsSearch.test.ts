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
  "harness.settings.diffColors": "Diff colors",
  "harness.settings.diffColorsDesc": "Choose colors for added and removed lines.",
  "harness.accounts.settingsTitle": "Provider accounts",
  "harness.accounts.settingsDescription": "Manage provider sign-in accounts.",
  "harness.settings.usageDisplay": "Usage display",
  "harness.settingsEntries.showRemainingUsage": "Show remaining usage",
  "harness.settings.providers": "Providers",
  "harness.chrome.providersIntroLong": "Choose the default CLI model for new sessions.",
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

  it("finds the diff palette from accessibility keywords", () => {
    const result = searchSettings("color blind", translate).find(
      (entry) => entry.id === "harness-diff-colors",
    );

    expect(result).toMatchObject({
      tab: "harness",
      titleKey: "harness.settings.diffColors",
      targetTitleKey: "harness.settings.diffColors",
    });
  });

  it("finds centralized Harness account and model settings", () => {
    expect(searchSettings("provider accounts", translate).map((entry) => entry.id)).toContain(
      "harness-provider-accounts",
    );
    expect(searchSettings("remaining usage", translate).map((entry) => entry.id)).toContain(
      "harness-usage-display",
    );
    expect(searchSettings("default cli model", translate).map((entry) => entry.id)).toContain(
      "harness-cli-defaults",
    );
  });
});
