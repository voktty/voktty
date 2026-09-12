export {
  ThemeProvider,
  useTheme,
  THEME_CHANGED_EVENT,
  type Theme,
} from "./ThemeProvider";
export { WindowVibrancyBridge } from "./WindowVibrancyBridge";
export {
  resolveTerminalFont,
  type TerminalFont,
} from "./resolveTerminalFont";
export { useThemeFileEditing } from "./useThemeFileEditing";
export {
  resolveThemeSwatch,
  formatThemeAppearanceLabel,
  nextVariationIdForTheme,
  resolveActiveVariation,
  type ThemeSwatch,
} from "./themeSwatch";
export { resolveEditorThemeId } from "./resolveEditorTheme";
export {
  listBuiltinAppearancePacks,
  getBuiltinAppearancePack,
  listBuiltinSurfaceProfiles,
  getBuiltinSurfaceProfile,
  listBuiltinTypographyProfiles,
  getBuiltinTypographyProfile,
  listBuiltinMaterialProfiles,
  getBuiltinMaterialProfile,
  BUILTIN_APPEARANCE_PACKS,
  BUILTIN_SURFACE_PROFILES,
  BUILTIN_TYPOGRAPHY_PROFILES,
  BUILTIN_MATERIAL_PROFILES,
} from "./packs";
export {
  resolveStructuralTraits,
  applyStructuralTraits,
  DEFAULT_STRUCTURAL_TRAITS,
  type StructuralTraits,
  type UserStructuralOverrides,
  type ResolvedAppearance,
} from "./resolveStructuralTraits";
export {
  DEFAULT_THEME_ID,
  DEFAULT_VARIATION_ID,
  DEFAULT_PACK_ID,
  type AppearancePack,
  type SurfaceProfile,
  type TypographyProfile,
  type MaterialProfile,
  type FileIconTheme,
  type ProductIconTheme,
  type ThemeSkin,
  type SkinFontDefinition,
} from "./types";
export * from "./skins";
