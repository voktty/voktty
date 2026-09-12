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
import { mac1Theme } from "./mac1Theme";
import { kdeTheme } from "./kdeTheme";
import { commanderBlueTheme } from "./commanderBlueTheme";
import { phosphorCrtTheme } from "./phosphorCrtTheme";
import { whistlerBlissTheme } from "./whistlerBlissTheme";
import { boingWorkbenchTheme } from "./boingWorkbenchTheme";
import { cubeStepTheme } from "./cubeStepTheme";
import { yellowTabOsTheme } from "./yellowTabOsTheme";
import { solarCdeTheme } from "./solarCdeTheme";
import { humanity2006Theme } from "./humanity2006Theme";
import { pocket89Theme } from "./pocket89Theme";
import { pilotPdaTheme } from "./pilotPdaTheme";
import { clickWheelPodTheme } from "./clickWheelPodTheme";
import { station94Theme } from "./station94Theme";
import { audioAmpClassicTheme } from "./audioAmpClassicTheme";
import { cyberCafe99Theme } from "./cyberCafe99Theme";
import { tigerAquaTheme } from "./tigerAquaTheme";
import { mediaStation9Theme } from "./mediaStation9Theme";
import { instantChat7Theme } from "./instantChat7Theme";
import { bbsDialupTheme } from "./bbsDialupTheme";
import { tide } from "./tide";
import { tokyoNight } from "./tokyo-night";
import { xcode } from "./xcode";
export { LEGACY_THEME_TO_VARIATION, isLegacyVariationId } from "../legacyThemeIds";

export {
  VOKTTY_VARIATIONS,
  vokttyDefault,
  win31Theme,
  mac1Theme,
  kdeTheme,
  commanderBlueTheme,
  phosphorCrtTheme,
  whistlerBlissTheme,
  boingWorkbenchTheme,
  cubeStepTheme,
  yellowTabOsTheme,
  solarCdeTheme,
  humanity2006Theme,
  pocket89Theme,
  pilotPdaTheme,
  clickWheelPodTheme,
  station94Theme,
  audioAmpClassicTheme,
  cyberCafe99Theme,
  tigerAquaTheme,
  mediaStation9Theme,
  instantChat7Theme,
  bbsDialupTheme,
};

const BUILTIN: Theme[] = [
  vokttyDefault,
  win31Theme,
  mac1Theme,
  kdeTheme,
  commanderBlueTheme,
  phosphorCrtTheme,
  whistlerBlissTheme,
  boingWorkbenchTheme,
  cubeStepTheme,
  yellowTabOsTheme,
  solarCdeTheme,
  humanity2006Theme,
  pocket89Theme,
  pilotPdaTheme,
  clickWheelPodTheme,
  station94Theme,
  audioAmpClassicTheme,
  cyberCafe99Theme,
  tigerAquaTheme,
  mediaStation9Theme,
  instantChat7Theme,
  bbsDialupTheme,
];

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

export function listBuiltinThemes(): Theme[] {
  return BUILTIN;
}

export function getBuiltinVariations(): ThemeVariation[] {
  return VOKTTY_VARIATIONS;
}

export function getBuiltinTheme(id: string): Theme | undefined {
  if (id === DEFAULT_THEME_ID || id === "voktty") return vokttyDefault;
  if (id === "win31") return win31Theme;
  if (id === "mac1") return mac1Theme;
  if (id === "kde") return kdeTheme;
  if (id === "commander-blue") return commanderBlueTheme;
  if (id === "phosphor-crt") return phosphorCrtTheme;
  if (id === "whistler-bliss") return whistlerBlissTheme;
  if (id === "boing-workbench") return boingWorkbenchTheme;
  if (id === "cubestep") return cubeStepTheme;
  if (id === "yellowtab-os") return yellowTabOsTheme;
  if (id === "solar-cde") return solarCdeTheme;
  if (id === "humanity-2006") return humanity2006Theme;
  if (id === "pocket-89") return pocket89Theme;
  if (id === "pilot-pda") return pilotPdaTheme;
  if (id === "clickwheel-pod") return clickWheelPodTheme;
  if (id === "station-94") return station94Theme;
  if (id === "audioamp-classic") return audioAmpClassicTheme;
  if (id === "cybercafe-99") return cyberCafe99Theme;
  if (id === "tiger-aqua") return tigerAquaTheme;
  if (id === "media-station-9") return mediaStation9Theme;
  if (id === "instant-chat-7") return instantChat7Theme;
  if (id === "bbs-dialup") return bbsDialupTheme;
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
