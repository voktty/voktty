import { DEFAULT_THEME_ID, type Theme, type ThemeVariation } from "../types";
import { caffeine } from "./caffeine";
import { catppuccin } from "./catppuccin";
import { claude } from "./claude";
import { dracula } from "./dracula";
import { everforest } from "./everforest";
import { fluentDark } from "./fluent-dark";
import { fluentLight } from "./fluent-light";
import { gruvbox } from "./gruvbox";
import { kanagawa } from "./kanagawa";
import { kanagawaDragon } from "./kanagawa-dragon";
import { nord } from "./nord";
import { rosePine } from "./rose-pine";
import { sage } from "./sage";
import { solarized } from "./solarized";
import { vokttyDefault, VOKTTY_VARIATIONS } from "./voktty-default";
import { win31Theme } from "./win31Theme";
import { tide } from "./tide";
import { tokyoNight } from "./tokyo-night";
import { xcode } from "./xcode";

export { VOKTTY_VARIATIONS, vokttyDefault, win31Theme };

const BUILTIN: Theme[] = [vokttyDefault, win31Theme];

const LEGACY_FALLBACKS: Record<string, Theme> = {
  "fluent-dark": fluentDark,
  "fluent-light": fluentLight,
  nord,
  dracula,
  "tokyo-night": tokyoNight,
  catppuccin,
  "rose-pine": rosePine,
  everforest,
  gruvbox,
  solarized,
  kanagawa,
  "kanagawa-dragon": kanagawaDragon,
  claude,
  xcode,
  tide,
  sage,
  caffeine,
};

export const LEGACY_THEME_TO_VARIATION: Record<string, string> = {
  "voktty-default": "default",
  voktty: "default",
  "fluent-dark": "fluent",
  "fluent-light": "fluent",
  fluent: "fluent",
  nord: "nord",
  dracula: "dracula",
  "tokyo-night": "tokyo-night",
  catppuccin: "catppuccin",
  "rose-pine": "rose-pine",
  everforest: "everforest",
  gruvbox: "gruvbox",
  solarized: "solarized",
  kanagawa: "kanagawa",
  "kanagawa-dragon": "kanagawa-dragon",
  claude: "claude",
  xcode: "xcode",
  tide: "tide",
  sage: "sage",
  caffeine: "caffeine",
};

export function isLegacyVariationId(id: string): string | null {
  return LEGACY_THEME_TO_VARIATION[id] ?? null;
}

export function listBuiltinThemes(): Theme[] {
  return BUILTIN;
}

export function getBuiltinVariations(): ThemeVariation[] {
  return VOKTTY_VARIATIONS;
}

export function getBuiltinTheme(id: string): Theme | undefined {
  if (id === DEFAULT_THEME_ID || id === "voktty") return vokttyDefault;
  if (id === "win31") return win31Theme;
  if (LEGACY_FALLBACKS[id]) return LEGACY_FALLBACKS[id];
  const variation = VOKTTY_VARIATIONS.find((v) => v.id === id);
  if (variation) {
    return {
      id: variation.id,
      name: variation.name,
      description: variation.description,
      editorTheme: variation.editorTheme,
      variants: variation.variants,
    };
  }
  return undefined;
}

export function getDefaultTheme(): Theme {
  return vokttyDefault;
}

