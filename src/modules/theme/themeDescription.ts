import type { Theme, ThemeVariation } from "./types";

type Translate = (key: string) => string;

const THEME_IDS = new Set([
  "voktty-default",
  "win31",
  "mac1",
  "kde",
  "commander-blue",
  "phosphor-crt",
  "whistler-bliss",
  "boing-workbench",
  "cubestep",
  "yellowtab-os",
  "solar-cde",
  "humanity-2006",
  "pocket-89",
  "pilot-pda",
  "clickwheel-pod",
  "station-94",
  "audioamp-classic",
  "cybercafe-99",
  "tiger-aqua",
  "media-station-9",
  "instant-chat-7",
  "bbs-dialup",
]);

const VOKTTY_VARIATION_IDS = new Set([
  "default",
  "fluent",
  "nord",
  "dracula",
  "tokyo-night",
  "catppuccin",
  "rose-pine",
  "everforest",
  "gruvbox",
  "solarized",
  "kanagawa",
  "kanagawa-dragon",
  "claude",
  "xcode",
  "tide",
  "sage",
  "caffeine",
]);

export function resolveThemeDescription(
  t: Translate,
  theme: Theme,
  variation?: ThemeVariation,
): string | undefined {
  if (
    theme.id === "voktty-default" &&
    variation &&
    VOKTTY_VARIATION_IDS.has(variation.id)
  ) {
    return t(`themes.descriptions.vokttyDefault.${variation.id}`);
  }

  if (THEME_IDS.has(theme.id)) return t(`themes.descriptions.${theme.id}`);
  return variation?.description ?? theme.description;
}
