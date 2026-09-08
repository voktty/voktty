import type { Theme, ThemeMode, ThemeVariation } from "./types";

export type ThemeSwatch = {
  background: string;
  foreground: string;
  accent: string;
  muted: string;
};

const LIGHT_FALLBACK: ThemeSwatch = {
  background: "#f4f5f8",
  foreground: "#18191c",
  accent: "var(--accent)",
  muted: "#e5e7eb",
};

const DARK_FALLBACK: ThemeSwatch = {
  background: "#121214",
  foreground: "#f4f4f6",
  accent: "var(--accent)",
  muted: "#262932",
};

export function resolveActiveVariation(
  theme: Theme,
  variationId: string,
): ThemeVariation | undefined {
  if (!theme.variations || theme.variations.length === 0) return undefined;
  return (
    theme.variations.find((item) => item.id === variationId) ??
    theme.variations.find((item) => item.id === theme.defaultVariation) ??
    theme.variations[0]
  );
}

export function resolveThemeSwatch(
  theme: Theme,
  variationId: string,
  mode: ThemeMode,
): ThemeSwatch {
  const fallback = mode === "light" ? LIGHT_FALLBACK : DARK_FALLBACK;
  const variation = resolveActiveVariation(theme, variationId);
  const variant =
    variation?.variants[mode] ??
    variation?.variants.dark ??
    variation?.variants.light ??
    theme.variants[mode] ??
    theme.variants.dark ??
    theme.variants.light;
  const colors = variant?.colors;
  return {
    background: colors?.background ?? fallback.background,
    foreground: colors?.foreground ?? fallback.foreground,
    accent:
      variation?.accentColor ??
      colors?.primary ??
      colors?.accent ??
      fallback.accent,
    muted: colors?.muted ?? fallback.muted,
  };
}

export function formatThemeAppearanceLabel(
  theme: Theme,
  variationId: string,
): string {
  const variation = resolveActiveVariation(theme, variationId);
  if (!variation || !theme.variations || theme.variations.length === 0) {
    return theme.name;
  }
  return `${theme.name} · ${variation.name}`;
}

export function nextVariationIdForTheme(
  theme: Theme,
  currentVariationId: string,
): string | null {
  if (!theme.variations || theme.variations.length === 0) return null;
  if (theme.variations.some((item) => item.id === currentVariationId)) {
    return currentVariationId;
  }
  return theme.defaultVariation ?? theme.variations[0]?.id ?? null;
}
