import type {
  AppearancePack,
  MaterialProfile,
  SurfaceProfile,
  TypographyProfile,
} from "./types";

export const BUILTIN_MATERIAL_PROFILES: MaterialProfile[] = [
  {
    id: "solid",
    name: "Solid",
    description: "Opaque desktop surfaces with no glass treatment.",
    chromeOpacity: 1,
    chromeBlur: "0px",
    chromeSaturation: 1,
    borderOpacity: 1,
  },
  {
    id: "liquid",
    name: "Liquid",
    description: "Translucent navigation chrome while content remains solid.",
    chromeOpacity: 0.72,
    chromeBlur: "20px",
    chromeSaturation: 1.25,
    borderOpacity: 0.82,
  },
];

export const BUILTIN_SURFACE_PROFILES: SurfaceProfile[] = [
  {
    id: "default",
    name: "Default (Theme Native)",
    description: "Derive surface tokens directly from the active theme colors.",
    canvas: "var(--background-base)",
    sidebar: "var(--sidebar)",
    toolbar: "var(--frame)",
    pane: "var(--card)",
    header: "var(--secondary)",
    popover: "var(--popover)",
    activeItem: "var(--accent)",
    borderSubtle: "var(--border)",
    opacity: 1.0,
    elevationStyle: "soft",
    borderWidth: "1px",
    borderStyle: "solid",
  },
  {
    id: "fluent-solid",
    name: "Fluent Solid",
    description: "Deep Carbon solid elevation with crisp 1px borders.",
    canvas: "#121214",
    sidebar: "#16171a",
    toolbar: "#191a1e",
    pane: "#1e2025",
    header: "#1c1d22",
    popover: "#22252a",
    activeItem: "#262932",
    borderSubtle: "rgba(255, 255, 255, 0.07)",
    opacity: 1.0,
    elevationStyle: "soft",
    borderWidth: "1px",
    borderStyle: "solid",
  },
  {
    id: "fluent-acrylic",
    name: "Fluent Acrylic",
    description: "Subtle translucent acrylic backdrop for Mica / Vibrancy.",
    canvas: "rgba(18, 18, 20, 0.85)",
    sidebar: "rgba(22, 23, 26, 0.75)",
    toolbar: "rgba(25, 26, 30, 0.80)",
    pane: "rgba(30, 32, 37, 0.90)",
    header: "rgba(28, 29, 34, 0.85)",
    popover: "rgba(34, 37, 42, 0.95)",
    activeItem: "rgba(38, 41, 50, 0.80)",
    borderSubtle: "rgba(255, 255, 255, 0.09)",
    opacity: 0.85,
    elevationStyle: "soft",
    borderWidth: "1px",
    borderStyle: "solid",
  },
];

export const BUILTIN_TYPOGRAPHY_PROFILES: TypographyProfile[] = [
  {
    id: "default",
    name: "Default (Inter)",
    uiFontFamily: "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    editorFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    terminalFontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    uiFontSize: 13,
    lineHeight: 1.5,
    density: "comfortable",
    fontSmoothing: "antialiased",
  },
  {
    id: "fluent-compact",
    name: "Fluent Compact",
    uiFontFamily: "'Segoe UI Variable', 'SF Pro Text', 'Inter Variable', sans-serif",
    editorFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    terminalFontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    uiFontSize: 12,
    lineHeight: 1.4,
    density: "compact",
    fontSmoothing: "antialiased",
  },
  {
    id: "fluent-comfortable",
    name: "Fluent Comfortable",
    uiFontFamily: "'Segoe UI Variable', 'SF Pro Text', 'Inter Variable', sans-serif",
    editorFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    terminalFontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    uiFontSize: 13,
    lineHeight: 1.5,
    density: "comfortable",
    fontSmoothing: "antialiased",
  },
];

export const BUILTIN_APPEARANCE_PACKS: AppearancePack[] = [
  {
    id: "default",
    name: "Default (Obsidian)",
    description: "Canonical Voktty desktop experience with Inter typography.",
    colorThemeId: "voktty-default",
    variationId: "default",
    surfaceProfileId: "default",
    typographyProfileId: "default",
    materialProfileId: "solid",
    elevationStyle: "soft",
    pillRadius: "9999px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
  },
  {
    id: "fluent-dark",
    name: "Fluent Dark",
    description: "Canon Windows Fluent Dark desktop experience with Carbon surfaces.",
    colorThemeId: "voktty-default",
    variationId: "fluent",
    surfaceProfileId: "fluent-solid",
    typographyProfileId: "fluent-compact",
    materialProfileId: "solid",
    elevationStyle: "soft",
    pillRadius: "9999px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
  },
  {
    id: "fluent-light",
    name: "Fluent Light",
    description: "Crisp Windows Fluent Light desktop experience with clean surfaces.",
    colorThemeId: "voktty-default",
    variationId: "fluent",
    surfaceProfileId: "fluent-solid",
    typographyProfileId: "fluent-compact",
    materialProfileId: "solid",
    elevationStyle: "soft",
    pillRadius: "9999px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    description: "Inky dark aesthetic inspired by Hokusai with Lotus light fallback.",
    colorThemeId: "voktty-default",
    variationId: "kanagawa",
    surfaceProfileId: "fluent-solid",
    typographyProfileId: "fluent-compact",
    materialProfileId: "solid",
    elevationStyle: "soft",
    pillRadius: "9999px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
  },
  {
    id: "voktty-liquid",
    name: "Voktty Liquid",
    description: "Adaptive glass chrome with solid work surfaces on every platform.",
    colorThemeId: "voktty-default",
    variationId: "liquid",
    surfaceProfileId: "default",
    typographyProfileId: "default",
    materialProfileId: "liquid",
    elevationStyle: "soft",
    pillRadius: "10px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
  },
];

const SURFACES_BY_ID = new Map(BUILTIN_SURFACE_PROFILES.map((s) => [s.id, s]));
const TYPOGRAPHY_BY_ID = new Map(BUILTIN_TYPOGRAPHY_PROFILES.map((t) => [t.id, t]));
const MATERIALS_BY_ID = new Map(BUILTIN_MATERIAL_PROFILES.map((m) => [m.id, m]));
const PACKS_BY_ID = new Map(BUILTIN_APPEARANCE_PACKS.map((p) => [p.id, p]));

export function listBuiltinSurfaceProfiles(): SurfaceProfile[] {
  return BUILTIN_SURFACE_PROFILES;
}

export function getBuiltinSurfaceProfile(id: string): SurfaceProfile | undefined {
  return SURFACES_BY_ID.get(id);
}

export function listBuiltinTypographyProfiles(): TypographyProfile[] {
  return BUILTIN_TYPOGRAPHY_PROFILES;
}

export function getBuiltinTypographyProfile(id: string): TypographyProfile | undefined {
  return TYPOGRAPHY_BY_ID.get(id);
}

export function listBuiltinMaterialProfiles(): MaterialProfile[] {
  return BUILTIN_MATERIAL_PROFILES;
}

export function getBuiltinMaterialProfile(id: string): MaterialProfile | undefined {
  return MATERIALS_BY_ID.get(id);
}

export function listBuiltinAppearancePacks(): AppearancePack[] {
  return BUILTIN_APPEARANCE_PACKS;
}

export function getBuiltinAppearancePack(id: string): AppearancePack | undefined {
  return PACKS_BY_ID.get(id);
}
