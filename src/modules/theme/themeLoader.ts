import { defaultTheme } from "./defaultTheme";
import type { Theme, ThemeVariation } from "./types";

const cache = new Map<string, Theme>([[defaultTheme.id, defaultTheme], ["voktty", defaultTheme]]);
const pending = new Map<string, Promise<Theme>>();

const loaders: Record<string, () => Promise<Theme>> = {
  win31: () => import("./themes/win31Theme").then((m) => m.win31Theme),
  mac1: () => import("./themes/mac1Theme").then((m) => m.mac1Theme),
  kde: () => import("./themes/kdeTheme").then((m) => m.kdeTheme),
  "commander-blue": () => import("./themes/commanderBlueTheme").then((m) => m.commanderBlueTheme),
  "phosphor-crt": () => import("./themes/phosphorCrtTheme").then((m) => m.phosphorCrtTheme),
  "whistler-bliss": () => import("./themes/whistlerBlissTheme").then((m) => m.whistlerBlissTheme),
  "boing-workbench": () => import("./themes/boingWorkbenchTheme").then((m) => m.boingWorkbenchTheme),
  cubestep: () => import("./themes/cubeStepTheme").then((m) => m.cubeStepTheme),
  "yellowtab-os": () => import("./themes/yellowTabOsTheme").then((m) => m.yellowTabOsTheme),
  "solar-cde": () => import("./themes/solarCdeTheme").then((m) => m.solarCdeTheme),
  "humanity-2006": () => import("./themes/humanity2006Theme").then((m) => m.humanity2006Theme),
  "pocket-89": () => import("./themes/pocket89Theme").then((m) => m.pocket89Theme),
  "pilot-pda": () => import("./themes/pilotPdaTheme").then((m) => m.pilotPdaTheme),
  "clickwheel-pod": () => import("./themes/clickWheelPodTheme").then((m) => m.clickWheelPodTheme),
  "station-94": () => import("./themes/station94Theme").then((m) => m.station94Theme),
  "audioamp-classic": () => import("./themes/audioAmpClassicTheme").then((m) => m.audioAmpClassicTheme),
  "cybercafe-99": () => import("./themes/cyberCafe99Theme").then((m) => m.cyberCafe99Theme),
  "tiger-aqua": () => import("./themes/tigerAquaTheme").then((m) => m.tigerAquaTheme),
  "media-station-9": () => import("./themes/mediaStation9Theme").then((m) => m.mediaStation9Theme),
  "instant-chat-7": () => import("./themes/instantChat7Theme").then((m) => m.instantChat7Theme),
  "bbs-dialup": () => import("./themes/bbsDialupTheme").then((m) => m.bbsDialupTheme),
};

function variationTheme(id: string, palette: Theme): Theme {
  const variation: ThemeVariation = {
    id, name: palette.name, description: palette.description,
    editorTheme: palette.editorTheme, variants: palette.variants,
  };
  return { ...defaultTheme, variations: [variation], defaultVariation: id };
}

const variationLoaders: Record<string, () => Promise<Theme>> = {
  nord: () => import("./themes/nord").then((m) => variationTheme("nord", m.nord)),
  dracula: () => import("./themes/dracula").then((m) => variationTheme("dracula", m.dracula)),
  "tokyo-night": () => import("./themes/tokyo-night").then((m) => variationTheme("tokyo-night", m.tokyoNight)),
  catppuccin: () => import("./themes/catppuccin").then((m) => variationTheme("catppuccin", m.catppuccin)),
  "rose-pine": () => import("./themes/rose-pine").then((m) => variationTheme("rose-pine", m.rosePine)),
  everforest: () => import("./themes/everforest").then((m) => variationTheme("everforest", m.everforest)),
  gruvbox: () => import("./themes/gruvbox").then((m) => variationTheme("gruvbox", m.gruvbox)),
  solarized: () => import("./themes/solarized").then((m) => variationTheme("solarized", m.solarized)),
  kanagawa: () => import("./themes/kanagawa").then((m) => variationTheme("kanagawa", m.kanagawa)),
  "kanagawa-dragon": () => import("./themes/kanagawa-dragon").then((m) => variationTheme("kanagawa-dragon", m.kanagawaDragon)),
  claude: () => import("./themes/claude").then((m) => variationTheme("claude", m.claude)),
  xcode: () => import("./themes/xcode").then((m) => variationTheme("xcode", m.xcode)),
  tide: () => import("./themes/tide").then((m) => variationTheme("tide", m.tide)),
  sage: () => import("./themes/sage").then((m) => variationTheme("sage", m.sage)),
  caffeine: () => import("./themes/caffeine").then((m) => variationTheme("caffeine", m.caffeine)),
  fluent: () => Promise.all([import("./themes/fluent-dark"), import("./themes/fluent-light")]).then(([dark, light]) => variationTheme("fluent", {
    ...dark.fluentDark,
    variants: { dark: dark.fluentDark.variants.dark, light: light.fluentLight.variants.light },
  })),
};

export function getLoadedBuiltinTheme(id: string): Theme | undefined {
  return cache.get(id);
}

export function getLoadedDefaultTheme(): Theme {
  return cache.get("voktty-default") ?? defaultTheme;
}

export function loadBuiltinTheme(id: string): Promise<Theme> {
  if (id === "default") return Promise.resolve(defaultTheme);
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(id);
  if (existing) return existing;
  const direct = loaders[id] ?? variationLoaders[id];
  if (!direct) return Promise.resolve(defaultTheme);
  const load = direct().then((theme) => {
    cache.set(id, theme);
    if (variationLoaders[id]) cache.set("voktty-default", theme);
    return theme;
  }).finally(() => pending.delete(id));
  pending.set(id, load);
  return load;
}
