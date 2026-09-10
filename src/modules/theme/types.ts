export type ThemeMode = "light" | "dark";

export type ThemeColors = Partial<{
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  radius: string;
  // Fluent Surface Hierarchy & Accent Tokens
  surfaceCanvas: string;
  surfaceSidebar: string;
  surfaceToolbar: string;
  surfaceCard: string;
  surfacePane: string;
  surfaceHeader: string;
  surfacePopover: string;
  surfaceActiveItem: string;
  accentAction: string;
  accentIndicator: string;
  borderSubtle: string;
}>;

export type TerminalPalette = Partial<{
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
  ansi: readonly [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
}>;

export type ThemeVariant = {
  colors?: ThemeColors;
  terminal?: TerminalPalette;
};

export type ThemeVariation = {
  id: string;
  name: string;
  description?: string;
  variants: {
    light?: ThemeVariant;
    dark?: ThemeVariant;
  };
  editorTheme?: {
    light?: string;
    dark?: string;
  };
  accentColor?: string;
  surfaceProfileId?: string;
  typographyProfileId?: string;
  appearancePackId?: string;
  skinId?: string;
  windowCorners?: "round" | "square" | "default";
  elevationStyle?: "soft" | "bevel" | "flat";
  pillRadius?: string;
  borderWidth?: string;
  borderStyle?: string;
  focusStyle?: "ring" | "dotted" | "invert";
  uiFontSmoothing?: "antialiased" | "subpixel-antialiased" | "none";
  density?: "compact" | "normal" | "comfortable";
};

export type Theme = {
  id: string;
  name: string;
  author?: string;
  description?: string;
  variants: {
    light?: ThemeVariant;
    dark?: ThemeVariant;
  };
  editorTheme?: {
    light?: string;
    dark?: string;
  };
  variations?: ThemeVariation[];
  defaultVariation?: string;
  surfaceProfileId?: string;
  typographyProfileId?: string;
  appearancePackId?: string;
  skinId?: string;
  windowCorners?: "round" | "square" | "default";
  elevationStyle?: "soft" | "bevel" | "flat";
  pillRadius?: string;
  borderWidth?: string;
  borderStyle?: string;
  focusStyle?: "ring" | "dotted" | "invert";
  uiFontSmoothing?: "antialiased" | "subpixel-antialiased" | "none";
  density?: "compact" | "normal" | "comfortable";
};

export type SurfaceProfile = {
  id: string;
  name: string;
  description?: string;
  canvas: string;
  sidebar: string;
  toolbar: string;
  pane: string;
  header: string;
  popover: string;
  activeItem: string;
  borderSubtle: string;
  card?: string;
  opacity?: number;
  elevationStyle?: "soft" | "bevel" | "flat";
  borderWidth?: string;
  borderStyle?: string;
};

export type TypographyProfile = {
  id: string;
  name: string;
  uiFontFamily: string;
  editorFontFamily: string;
  terminalFontFamily: string;
  uiFontSize: number;
  lineHeight: number;
  density: "compact" | "normal" | "comfortable";
  fontSmoothing?: "antialiased" | "subpixel-antialiased" | "none";
};

/**
 * Describes how chrome is painted independently from the color palette. The
 * profile is deliberately small: content surfaces stay solid while chrome can
 * opt into a platform-appropriate material.
 */
export type MaterialProfile = {
  id: string;
  name: string;
  description?: string;
  chromeOpacity: number;
  chromeBlur: string;
  chromeSaturation: number;
  borderOpacity: number;
};

export type StructuralTraits = {
  elevationStyle: "soft" | "bevel" | "flat";
  pillRadius: string;
  borderWidth: string;
  borderStyle: string;
  focusStyle: "ring" | "dotted" | "invert";
  uiFontFamily: string;
  uiFontSize: number;
  uiLineHeight: number;
  uiFontSmoothing: "antialiased" | "subpixel-antialiased" | "none";
  density: "compact" | "normal" | "comfortable";
  windowCorners?: "round" | "square" | "default";
};

export type SkinFontDefinition = {
  family: string;
  src: string;
  weight?: string;
  style?: string;
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
};

export type ThemeSkin = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  css: string;
  fonts?: SkinFontDefinition[];
  windowCorners?: "round" | "square" | "default";
  structuralTraits?: Partial<StructuralTraits>;
};

export type FileIconTheme = {
  id: string;
  name: string;
  icons: Record<string, string>;
};

export type ProductIconTheme = {
  id: string;
  name: string;
  strokeWidth: number;
  variant: "line" | "solid" | "duotone";
};

export type AppearancePack = {
  id: string;
  name: string;
  description?: string;
  colorThemeId: string;
  variationId?: string;
  skinId?: string;
  windowCorners?: "round" | "square" | "default";
  surfaceProfileId?: string;
  typographyProfileId?: string;
  materialProfileId?: string;
  fileIconThemeId?: string;
  productIconThemeId?: string;
  elevationStyle?: "soft" | "bevel" | "flat";
  pillRadius?: string;
  borderWidth?: string;
  borderStyle?: string;
  focusStyle?: "ring" | "dotted" | "invert";
};

export const DEFAULT_THEME_ID = "voktty-default";
export const DEFAULT_VARIATION_ID = "default";
export const DEFAULT_PACK_ID = "default";
