import { getBuiltinAppearancePack } from "./packs";
import type { AppearancePack } from "./types";

export type AppearanceSelection = {
  themeId: string;
  variationId: string;
  pack: AppearancePack | null;
};

export function resolveAppearanceSelection(input: {
  themeId: string;
  variationId: string;
  appearancePack: string | null | undefined;
  previewThemeId?: string | null;
  previewVariationId?: string | null;
}): AppearanceSelection {
  const pack =
    input.appearancePack &&
    input.appearancePack !== "auto" &&
    input.appearancePack !== "default"
      ? (getBuiltinAppearancePack(input.appearancePack) ?? null)
      : null;

  return {
    themeId: input.previewThemeId ?? pack?.colorThemeId ?? input.themeId,
    variationId:
      input.previewVariationId ?? pack?.variationId ?? input.variationId,
    pack,
  };
}
