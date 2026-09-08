import { describe, expect, it } from "vitest";
import { getDefaultTheme, getBuiltinTheme, listBuiltinThemes } from "./themes";
import {
  formatThemeAppearanceLabel,
  nextVariationIdForTheme,
  resolveActiveVariation,
  resolveThemeSwatch,
} from "./themeSwatch";

describe("themeSwatch", () => {
  it("resolves the named variation on voktty-default", () => {
    const theme = getDefaultTheme();
    const tokyo = resolveActiveVariation(theme, "tokyo-night");
    expect(tokyo?.id).toBe("tokyo-night");
    expect(tokyo?.name).toBe("Tokyo Night");
  });

  it("falls back to the default variation when the id is unknown", () => {
    const theme = getDefaultTheme();
    const fallback = resolveActiveVariation(theme, "not-a-variation");
    expect(fallback?.id).toBe("default");
  });

  it("builds swatches from the active variation palette", () => {
    const theme = getDefaultTheme();
    const swatch = resolveThemeSwatch(theme, "nord", "dark");
    expect(swatch.background).toBe("#2e3440");
    expect(swatch.accent).toBe("#88c0d0");
  });

  it("labels a theme with its sub-theme when variations exist", () => {
    const theme = getDefaultTheme();
    expect(formatThemeAppearanceLabel(theme, "catppuccin")).toBe(
      "Voktty · Catppuccin",
    );
    expect(formatThemeAppearanceLabel(theme, "default")).toBe(
      "Voktty · Obsidian",
    );
  });

  it("labels a skin without variations by theme name only", () => {
    const win31 = getBuiltinTheme("win31");
    expect(win31).toBeDefined();
    expect(formatThemeAppearanceLabel(win31!, "default")).toBe("Windows 3.1");
  });

  it("keeps a valid variation and replaces one the target theme does not own", () => {
    const voktty = getDefaultTheme();
    expect(nextVariationIdForTheme(voktty, "dracula")).toBe("dracula");
    expect(nextVariationIdForTheme(voktty, "missing")).toBe("default");

    const mac1 = getBuiltinTheme("mac1");
    expect(mac1).toBeDefined();
    expect(nextVariationIdForTheme(mac1!, "tokyo-night")).toBeNull();
  });

  it("exposes builtin families plus voktty color variations", () => {
    const builtin = listBuiltinThemes();
    const voktty = builtin.find((theme) => theme.id === "voktty-default");
    expect(voktty?.variations?.length).toBeGreaterThanOrEqual(17);
    expect(builtin.some((theme) => theme.id === "win31")).toBe(true);
  });
});
