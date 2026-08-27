import type { AppearancePack, SurfaceProfile, TypographyProfile } from "./types";

export const BUILTIN_SURFACE_PROFILES: SurfaceProfile[] = [
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
  },
];

export const BUILTIN_TYPOGRAPHY_PROFILES: TypographyProfile[] = [
  {
    id: "fluent-compact",
    name: "Fluent Compact",
    uiFontFamily: "'Segoe UI Variable', 'SF Pro Text', 'Inter Variable', sans-serif",
    editorFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    terminalFontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    uiFontSize: 12,
    lineHeight: 1.4,
    density: "compact",
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
  },
];

export const BUILTIN_APPEARANCE_PACKS: AppearancePack[] = [
  {
    id: "fluent-dark",
    name: "Fluent Dark",
    description: "Canon Windows Fluent Dark desktop experience with Carbon surfaces.",
    colorThemeId: "fluent-dark",
    surfaceProfileId: "fluent-solid",
    typographyProfileId: "fluent-compact",
  },
  {
    id: "fluent-light",
    name: "Fluent Light",
    description: "Crisp Windows Fluent Light desktop experience with clean surfaces.",
    colorThemeId: "fluent-light",
    surfaceProfileId: "fluent-solid",
    typographyProfileId: "fluent-compact",
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    description: "Inky dark aesthetic inspired by Hokusai with Lotus light fallback.",
    colorThemeId: "kanagawa",
    surfaceProfileId: "fluent-solid",
    typographyProfileId: "fluent-compact",
  },
];

const PACKS_BY_ID = new Map(BUILTIN_APPEARANCE_PACKS.map((p) => [p.id, p]));

export function listBuiltinAppearancePacks(): AppearancePack[] {
  return BUILTIN_APPEARANCE_PACKS;
}

export function getBuiltinAppearancePack(id: string): AppearancePack | undefined {
  return PACKS_BY_ID.get(id);
}
