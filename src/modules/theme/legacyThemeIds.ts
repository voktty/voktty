/** Stable preference migration data, independent from palette modules. */
export const LEGACY_THEME_TO_VARIATION: Record<string, string> = {
  "voktty-default": "default", voktty: "default", "fluent-dark": "fluent",
  "fluent-light": "fluent", fluent: "fluent", nord: "nord", dracula: "dracula",
  "tokyo-night": "tokyo-night", catppuccin: "catppuccin", "rose-pine": "rose-pine",
  everforest: "everforest", gruvbox: "gruvbox", solarized: "solarized",
  kanagawa: "kanagawa", "kanagawa-dragon": "kanagawa-dragon", claude: "claude",
  xcode: "xcode", tide: "tide", sage: "sage", caffeine: "caffeine",
};

export function isLegacyVariationId(id: string): string | null {
  return LEGACY_THEME_TO_VARIATION[id] ?? null;
}
