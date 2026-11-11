import type { WindowMaterialPref } from "@/modules/settings/store";

/** Mirrors `WindowMaterial` in `src-tauri/src/modules/vibrancy.rs`. */
export type WindowMaterial = "mica" | "mica-alt" | "acrylic";

/**
 * Dark variations with a near-black canvas, where blurring what sits behind
 * the window reads well. Light modes and the remaining variations keep the
 * calmer Mica, which only tints with the wallpaper.
 */
const ACRYLIC_VARIATIONS = new Set([
  "default",
  "voktty-default",
  "fluent",
  "liquid",
  "tokyo-night",
  "catppuccin",
  "rose-pine",
  "dracula",
  "kanagawa",
]);

/**
 * The backdrop to paint, or "none" for an opaque window. Period skins stay
 * opaque in "auto": the systems they imitate had no translucency. An
 * explicit choice wins over the theme, and a material this Windows cannot
 * paint falls back to Mica when it can, or opaque.
 */
export function resolveWindowMaterial(
  pref: WindowMaterialPref,
  theme: { variationId: string | null; skinId?: string | null; dark: boolean },
  supported: readonly WindowMaterial[],
): WindowMaterial | "none" {
  let wanted: WindowMaterial | "none";
  if (pref !== "auto") wanted = pref;
  else if (theme.skinId) wanted = "none";
  else if (theme.dark && ACRYLIC_VARIATIONS.has(theme.variationId ?? "default"))
    wanted = "acrylic";
  else wanted = "mica";
  if (wanted === "none" || supported.includes(wanted)) return wanted;
  return supported.includes("mica") ? "mica" : "none";
}
