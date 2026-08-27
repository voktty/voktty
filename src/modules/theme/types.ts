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
  opacity?: number;
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
  surfaceProfileId?: string;
  typographyProfileId?: string;
  fileIconThemeId?: string;
  productIconThemeId?: string;
};

export const DEFAULT_THEME_ID = "voktty-default";
export const DEFAULT_PACK_ID = "fluent-dark";
