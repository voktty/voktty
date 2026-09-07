import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_STRUCTURAL_TRAITS,
  applyStructuralTraits,
  resolveStructuralTraits,
} from "./resolveStructuralTraits";
import {
  getBuiltinAppearancePack,
  getBuiltinSurfaceProfile,
  getBuiltinTypographyProfile,
  listBuiltinAppearancePacks,
  listBuiltinSurfaceProfiles,
  listBuiltinTypographyProfiles,
} from "./packs";
import type { Theme, ThemeVariation } from "./types";

function createMockRoot() {
  const styles = new Map<string, string>();
  const attributes = new Map<string, string>();

  return {
    style: {
      setProperty: (name: string, value: string) => styles.set(name, value),
      getPropertyValue: (name: string) => styles.get(name) ?? "",
      removeProperty: (name: string) => styles.delete(name),
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => attributes.delete(name),
  };
}

describe("Structural Traits and Profiles Precedence", () => {
  let mockRoot: ReturnType<typeof createMockRoot>;

  beforeEach(() => {
    mockRoot = createMockRoot();
    Object.defineProperty(globalThis, "document", {
      value: { documentElement: mockRoot },
      configurable: true,
    });
  });

  afterEach(() => {
    // @ts-expect-error cleanup mock
    delete globalThis.document;
  });

  it("lists all builtin profiles and packs with defaults", () => {
    const packs = listBuiltinAppearancePacks();
    const surfaces = listBuiltinSurfaceProfiles();
    const typos = listBuiltinTypographyProfiles();

    expect(packs.length).toBeGreaterThanOrEqual(4);
    expect(surfaces.length).toBeGreaterThanOrEqual(3);
    expect(typos.length).toBeGreaterThanOrEqual(3);

    expect(getBuiltinAppearancePack("default")).toBeDefined();
    expect(getBuiltinAppearancePack("fluent-dark")).toBeDefined();
    expect(getBuiltinSurfaceProfile("fluent-solid")).toBeDefined();
    expect(getBuiltinTypographyProfile("fluent-compact")).toBeDefined();
  });

  it("resolves default structural traits when no pack or overrides are provided", () => {
    const resolved = resolveStructuralTraits({});

    expect(resolved.traits.elevationStyle).toBe("soft");
    expect(resolved.traits.pillRadius).toBe("9999px");
    expect(resolved.traits.borderWidth).toBe("1px");
    expect(resolved.traits.borderStyle).toBe("solid");
    expect(resolved.traits.focusStyle).toBe("ring");
    expect(resolved.traits.density).toBe("comfortable");
    expect(resolved.traits.uiFontSize).toBe(13);
    expect(resolved.traits.uiFontFamily).toContain("Inter Variable");
  });

  it("applies appearance pack traits over default baseline", () => {
    const resolved = resolveStructuralTraits({
      packId: "fluent-dark",
    });

    expect(resolved.pack?.id).toBe("fluent-dark");
    expect(resolved.surfaceProfile?.id).toBe("fluent-solid");
    expect(resolved.typographyProfile?.id).toBe("fluent-compact");
    expect(resolved.traits.uiFontSize).toBe(12);
    expect(resolved.traits.density).toBe("compact");
    expect(resolved.traits.uiFontFamily).toContain("Segoe UI Variable");
  });

  it("allows theme and variation to override pack properties", () => {
    const customTheme: Theme = {
      id: "voktty-default",
      name: "Voktty",
      variants: {},
      elevationStyle: "bevel",
      pillRadius: "4px",
    };

    const customVariation: ThemeVariation = {
      id: "custom-var",
      name: "Custom Variation",
      variants: {},
      typographyProfileId: "fluent-comfortable",
      borderWidth: "2px",
      borderStyle: "ridge",
      focusStyle: "dotted",
    };

    const resolved = resolveStructuralTraits({
      packId: "fluent-dark",
      theme: customTheme,
      variation: customVariation,
    });

    // Typography from variation
    expect(resolved.typographyProfile?.id).toBe("fluent-comfortable");
    expect(resolved.traits.uiFontSize).toBe(13);
    expect(resolved.traits.density).toBe("comfortable");

    // Structural overrides from theme and variation
    expect(resolved.traits.elevationStyle).toBe("bevel");
    expect(resolved.traits.pillRadius).toBe("4px");
    expect(resolved.traits.borderWidth).toBe("2px");
    expect(resolved.traits.borderStyle).toBe("ridge");
    expect(resolved.traits.focusStyle).toBe("dotted");
  });

  it("prioritizes explicit user overrides above variation, theme, and pack", () => {
    const customTheme: Theme = {
      id: "voktty-default",
      name: "Voktty",
      variants: {},
      elevationStyle: "bevel",
    };

    const customVariation: ThemeVariation = {
      id: "var-1",
      name: "Var 1",
      variants: {},
      typographyProfileId: "fluent-compact",
    };

    const resolved = resolveStructuralTraits({
      packId: "fluent-dark",
      theme: customTheme,
      variation: customVariation,
      userOverrides: {
        typographyProfile: "fluent-comfortable",
        surfaceProfile: "fluent-acrylic",
        elevationStyle: "flat",
      },
    });

    // User override wins on typography
    expect(resolved.typographyProfile?.id).toBe("fluent-comfortable");
    expect(resolved.traits.uiFontSize).toBe(13);

    // User override wins on surface profile
    expect(resolved.surfaceProfile?.id).toBe("fluent-acrylic");

    // User override wins on elevation style
    expect(resolved.traits.elevationStyle).toBe("flat");
  });

  it("applies structural traits to the DOM correctly", () => {
    const traits = {
      ...DEFAULT_STRUCTURAL_TRAITS,
      elevationStyle: "bevel" as const,
      pillRadius: "0px",
      borderWidth: "2px",
      borderStyle: "outset",
      focusStyle: "dotted" as const,
      uiFontFamily: "'MS Sans Serif', sans-serif",
      uiFontSize: 11,
      uiLineHeight: 1.2,
      uiFontSmoothing: "none" as const,
      density: "compact" as const,
    };

    const surfaceProfile = getBuiltinSurfaceProfile("fluent-solid");
    applyStructuralTraits(traits, surfaceProfile);

    expect(mockRoot.style.getPropertyValue("--elevation-style")).toBe("bevel");
    expect(mockRoot.style.getPropertyValue("--pill-radius")).toBe("0px");
    expect(mockRoot.style.getPropertyValue("--border-width")).toBe("2px");
    expect(mockRoot.style.getPropertyValue("--border-style")).toBe("outset");
    expect(mockRoot.style.getPropertyValue("--focus-style")).toBe("dotted");
    expect(mockRoot.style.getPropertyValue("--ui-font-family")).toBe("'MS Sans Serif', sans-serif");
    expect(mockRoot.style.getPropertyValue("--ui-font-size")).toBe("11px");
    expect(mockRoot.style.getPropertyValue("--ui-line-height")).toBe("1.2");
    expect(mockRoot.style.getPropertyValue("--ui-font-smoothing")).toBe("none");
    expect(mockRoot.style.getPropertyValue("--density")).toBe("compact");

    expect(mockRoot.getAttribute("data-elevation")).toBe("bevel");
    expect(mockRoot.getAttribute("data-focus-style")).toBe("dotted");
    expect(mockRoot.getAttribute("data-density")).toBe("compact");

    expect(mockRoot.style.getPropertyValue("--surface-sidebar")).toBe("#16171a");
    expect(mockRoot.style.getPropertyValue("--surface-card")).toBe("#1e2025");
  });
});
