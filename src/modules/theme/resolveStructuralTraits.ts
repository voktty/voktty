import {
  getBuiltinAppearancePack,
  getBuiltinSurfaceProfile,
  getBuiltinTypographyProfile,
} from "./packs";
import type {
  AppearancePack,
  StructuralTraits,
  SurfaceProfile,
  Theme,
  ThemeVariation,
  TypographyProfile,
} from "./types";

export type { StructuralTraits };

export const DEFAULT_STRUCTURAL_TRAITS: StructuralTraits = {
  elevationStyle: "soft",
  pillRadius: "9999px",
  borderWidth: "1px",
  borderStyle: "solid",
  focusStyle: "ring",
  uiFontFamily:
    "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  uiFontSize: 13,
  uiLineHeight: 1.5,
  uiFontSmoothing: "antialiased",
  density: "comfortable",
};

export type UserStructuralOverrides = {
  appearancePack?: string | null;
  surfaceProfile?: string | null;
  typographyProfile?: string | null;
  elevationStyle?: "soft" | "bevel" | "flat" | "auto" | null;
};

export type StructuralTraitsResolutionInput = {
  theme?: Theme | null;
  variation?: ThemeVariation | null;
  packId?: string | null;
  userOverrides?: UserStructuralOverrides;
};

export type ResolvedAppearance = {
  traits: StructuralTraits;
  pack: AppearancePack | null;
  surfaceProfile: SurfaceProfile | null;
  typographyProfile: TypographyProfile | null;
};

export function resolveStructuralTraits(
  input: StructuralTraitsResolutionInput,
): ResolvedAppearance {
  const traits: StructuralTraits = { ...DEFAULT_STRUCTURAL_TRAITS };

  // 1. Resolve pack
  let packId = input.packId ?? input.userOverrides?.appearancePack;
  if (!packId || packId === "auto") {
    packId =
      input.variation?.appearancePackId ??
      input.theme?.appearancePackId ??
      "default";
  }

  const pack = getBuiltinAppearancePack(packId) ?? null;

  // 2. Derive base profiles and traits from pack
  let typographyProfile: TypographyProfile | null = pack?.typographyProfileId
    ? (getBuiltinTypographyProfile(pack.typographyProfileId) ?? null)
    : null;

  let surfaceProfile: SurfaceProfile | null = pack?.surfaceProfileId
    ? (getBuiltinSurfaceProfile(pack.surfaceProfileId) ?? null)
    : null;

  if (pack?.elevationStyle) traits.elevationStyle = pack.elevationStyle;
  if (pack?.pillRadius) traits.pillRadius = pack.pillRadius;
  if (pack?.borderWidth) traits.borderWidth = pack.borderWidth;
  if (pack?.borderStyle) traits.borderStyle = pack.borderStyle;
  if (pack?.focusStyle) traits.focusStyle = pack.focusStyle;

  // 3. Theme & variation overrides
  const themeTypoId =
    input.variation?.typographyProfileId ?? input.theme?.typographyProfileId;
  if (themeTypoId) {
    const candidate = getBuiltinTypographyProfile(themeTypoId);
    if (candidate) typographyProfile = candidate;
  }

  const themeSurfaceId =
    input.variation?.surfaceProfileId ?? input.theme?.surfaceProfileId;
  if (themeSurfaceId) {
    const candidate = getBuiltinSurfaceProfile(themeSurfaceId);
    if (candidate) surfaceProfile = candidate;
  }

  const elevationOverride =
    input.variation?.elevationStyle ?? input.theme?.elevationStyle;
  if (elevationOverride) traits.elevationStyle = elevationOverride;

  const pillOverride =
    input.variation?.pillRadius ?? input.theme?.pillRadius;
  if (pillOverride) traits.pillRadius = pillOverride;

  const borderWidthOverride =
    input.variation?.borderWidth ?? input.theme?.borderWidth;
  if (borderWidthOverride) traits.borderWidth = borderWidthOverride;

  const borderStyleOverride =
    input.variation?.borderStyle ?? input.theme?.borderStyle;
  if (borderStyleOverride) traits.borderStyle = borderStyleOverride;

  const focusStyleOverride =
    input.variation?.focusStyle ?? input.theme?.focusStyle;
  if (focusStyleOverride) traits.focusStyle = focusStyleOverride;

  const smoothingOverride =
    input.variation?.uiFontSmoothing ?? input.theme?.uiFontSmoothing;
  if (smoothingOverride) traits.uiFontSmoothing = smoothingOverride;

  const densityOverride =
    input.variation?.density ?? input.theme?.density;
  if (densityOverride) traits.density = densityOverride;

  // 4. Apply typography profile tokens
  if (typographyProfile) {
    traits.uiFontFamily = typographyProfile.uiFontFamily;
    traits.uiFontSize = typographyProfile.uiFontSize;
    traits.uiLineHeight = typographyProfile.lineHeight;
    traits.density = typographyProfile.density;
    if (typographyProfile.fontSmoothing) {
      traits.uiFontSmoothing = typographyProfile.fontSmoothing;
    }
  }

  // 5. User explicit overrides (highest precedence)
  const userOverrides = input.userOverrides;
  if (
    userOverrides?.typographyProfile &&
    userOverrides.typographyProfile !== "auto" &&
    userOverrides.typographyProfile !== "default"
  ) {
    const customTypo = getBuiltinTypographyProfile(
      userOverrides.typographyProfile,
    );
    if (customTypo) {
      typographyProfile = customTypo;
      traits.uiFontFamily = customTypo.uiFontFamily;
      traits.uiFontSize = customTypo.uiFontSize;
      traits.uiLineHeight = customTypo.lineHeight;
      traits.density = customTypo.density;
      if (customTypo.fontSmoothing) {
        traits.uiFontSmoothing = customTypo.fontSmoothing;
      }
    }
  } else if (userOverrides?.typographyProfile === "default") {
    const defTypo = getBuiltinTypographyProfile("default");
    if (defTypo) {
      typographyProfile = defTypo;
      traits.uiFontFamily = defTypo.uiFontFamily;
      traits.uiFontSize = defTypo.uiFontSize;
      traits.uiLineHeight = defTypo.lineHeight;
      traits.density = defTypo.density;
      if (defTypo.fontSmoothing) {
        traits.uiFontSmoothing = defTypo.fontSmoothing;
      }
    }
  }

  if (
    userOverrides?.surfaceProfile &&
    userOverrides.surfaceProfile !== "auto" &&
    userOverrides.surfaceProfile !== "default"
  ) {
    const customSurf = getBuiltinSurfaceProfile(userOverrides.surfaceProfile);
    if (customSurf) surfaceProfile = customSurf;
  }

  if (
    userOverrides?.elevationStyle &&
    userOverrides.elevationStyle !== "auto"
  ) {
    traits.elevationStyle = userOverrides.elevationStyle;
  }

  return {
    traits,
    pack,
    surfaceProfile,
    typographyProfile,
  };
}

export function applyStructuralTraits(
  traits: StructuralTraits,
  surfaceProfile?: SurfaceProfile | null,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  root.style.setProperty("--elevation-style", traits.elevationStyle);
  root.style.setProperty("--pill-radius", traits.pillRadius);
  root.style.setProperty("--border-width", traits.borderWidth);
  root.style.setProperty("--border-style", traits.borderStyle);
  root.style.setProperty("--focus-style", traits.focusStyle);
  root.style.setProperty("--ui-font-family", traits.uiFontFamily);
  root.style.setProperty("--ui-font-size", `${traits.uiFontSize}px`);
  root.style.setProperty("--ui-line-height", String(traits.uiLineHeight));
  root.style.setProperty("--ui-font-smoothing", traits.uiFontSmoothing);
  root.style.setProperty("--density", traits.density);

  root.setAttribute("data-elevation", traits.elevationStyle);
  root.setAttribute("data-focus-style", traits.focusStyle);
  root.setAttribute("data-density", traits.density);

  if (surfaceProfile && surfaceProfile.id !== "default") {
    if (surfaceProfile.canvas)
      root.style.setProperty("--surface-canvas", surfaceProfile.canvas);
    if (surfaceProfile.sidebar)
      root.style.setProperty("--surface-sidebar", surfaceProfile.sidebar);
    if (surfaceProfile.toolbar)
      root.style.setProperty("--surface-toolbar", surfaceProfile.toolbar);
    if (surfaceProfile.pane)
      root.style.setProperty("--surface-pane", surfaceProfile.pane);
    if (surfaceProfile.card || surfaceProfile.pane)
      root.style.setProperty(
        "--surface-card",
        surfaceProfile.card ?? surfaceProfile.pane,
      );
    if (surfaceProfile.header)
      root.style.setProperty("--surface-header", surfaceProfile.header);
    if (surfaceProfile.popover)
      root.style.setProperty("--surface-popover", surfaceProfile.popover);
    if (surfaceProfile.activeItem)
      root.style.setProperty(
        "--surface-active-item",
        surfaceProfile.activeItem,
      );
    if (surfaceProfile.borderSubtle)
      root.style.setProperty(
        "--border-subtle",
        surfaceProfile.borderSubtle,
      );
  }
}
