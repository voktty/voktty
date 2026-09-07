import { describe, expect, it } from "vitest";
import {
  getBuiltinTheme,
  getDefaultTheme,
  isLegacyVariationId,
  listBuiltinThemes,
} from "./themes";
import { validateTheme } from "./validateTheme";

describe("Theme Variations & Legacy Resolution", () => {
  it("listBuiltinThemes returns the consolidated voktty theme and radical skins", () => {
    const builtin = listBuiltinThemes();
    expect(builtin.length).toBeGreaterThanOrEqual(4);
    const voktty = builtin.find((t) => t.id === "voktty-default");
    expect(voktty).toBeDefined();
    expect(voktty!.variations).toBeDefined();
    expect(voktty!.variations!.length).toBeGreaterThanOrEqual(17);
    expect(builtin.some((t) => t.id === "win31")).toBe(true);
    expect(builtin.some((t) => t.id === "mac1")).toBe(true);
    expect(builtin.some((t) => t.id === "kde")).toBe(true);
    expect(getBuiltinTheme("mac1")?.skinId).toBe("mac1");
    expect(getBuiltinTheme("kde")?.skinId).toBe("kde");
  });

  it("getDefaultTheme returns voktty-default", () => {
    const defaultTheme = getDefaultTheme();
    expect(defaultTheme.id).toBe("voktty-default");
  });

  it("resolves legacy theme ids transparently", () => {
    expect(isLegacyVariationId("fluent-dark")).toBe("fluent");
    expect(isLegacyVariationId("fluent-light")).toBe("fluent");
    expect(isLegacyVariationId("nord")).toBe("nord");
    expect(isLegacyVariationId("dracula")).toBe("dracula");
    expect(isLegacyVariationId("tokyo-night")).toBe("tokyo-night");
    expect(isLegacyVariationId("not-a-theme")).toBeNull();

    const nordTheme = getBuiltinTheme("nord");
    expect(nordTheme).toBeDefined();
    expect(nordTheme?.variants.dark?.colors?.background).toBe("#2e3440");

    const draculaTheme = getBuiltinTheme("dracula");
    expect(draculaTheme).toBeDefined();
    expect(draculaTheme?.variants.dark?.colors?.background).toBe("#282a36");
  });

  it("merges fluent-dark and fluent-light into a single fluent variation with both variants", () => {
    const voktty = getDefaultTheme();
    const fluentVar = voktty.variations?.find((v) => v.id === "fluent");
    expect(fluentVar).toBeDefined();
    expect(fluentVar?.variants.dark).toBeDefined();
    expect(fluentVar?.variants.light).toBeDefined();
    expect(fluentVar?.variants.dark?.colors?.background).toBe("#121214");
    expect(fluentVar?.variants.light?.colors?.background).toBe("#f4f5f8");
  });

  it("validates user themes without variations as before", () => {
    const custom: unknown = {
      id: "my-custom-theme",
      name: "Custom Theme",
      variants: {
        dark: {
          colors: {
            background: "#0a0a0a",
            foreground: "#ffffff",
          },
        },
      },
    };
    const result = validateTheme(custom);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.id).toBe("my-custom-theme");
      expect(result.theme.variations).toBeUndefined();
    }
  });

  it("validates user themes with variations", () => {
    const customWithVars: unknown = {
      id: "multi-palette",
      name: "Multi Palette",
      variants: {
        dark: { colors: { background: "#111111" } },
      },
      variations: [
        {
          id: "amber",
          name: "Amber",
          variants: {
            dark: { colors: { background: "#1c1408", primary: "#f59e0b" } },
          },
        },
      ],
    };
    const result = validateTheme(customWithVars);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.variations).toHaveLength(1);
      expect(result.theme.variations?.[0].id).toBe("amber");
    }
  });
});
