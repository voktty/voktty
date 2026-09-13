import type { Theme, ThemeVariation } from "./types";

const DEFAULT_VARIATIONS: ThemeVariation[] = [
  ["default", "Obsidian"],
  ["fluent", "Fluent"],
  ["liquid", "Liquid"],
  ["nord", "Nord"],
  ["dracula", "Dracula"],
  ["tokyo-night", "Tokyo Night"],
  ["catppuccin", "Catppuccin"],
  ["rose-pine", "Rosé Pine"],
  ["everforest", "Everforest"],
  ["gruvbox", "Gruvbox"],
  ["solarized", "Solarized"],
  ["kanagawa", "Kanagawa"],
  ["kanagawa-dragon", "Kanagawa Dragon"],
  ["claude", "Claude"],
  ["xcode", "Xcode"],
  ["tide", "Tide"],
  ["sage", "Sage"],
  ["caffeine", "Caffeine"],
].map(([id, name]) => ({ id, name, variants: {} }));

function catalogTheme(
  id: string,
  name: string,
  variations?: ThemeVariation[],
): Theme {
  return {
    id,
    name,
    variants: {},
    defaultVariation: variations?.[0]?.id,
    variations,
  };
}

export const builtinThemeCatalog: Theme[] = [
  catalogTheme("voktty-default", "Voktty", DEFAULT_VARIATIONS),
  catalogTheme("win31", "Windows 3.1"),
  catalogTheme("mac1", "Macintosh System 1"),
  catalogTheme("kde", "K-Desktop Classic"),
  catalogTheme("commander-blue", "Commander Blue"),
  catalogTheme("phosphor-crt", "Phosphor CRT"),
  catalogTheme("whistler-bliss", "Whistler Bliss"),
  catalogTheme("boing-workbench", "Boing Workbench"),
  catalogTheme("cubestep", "CubeStep"),
  catalogTheme("yellowtab-os", "YellowTab OS"),
  catalogTheme("solar-cde", "Solar Workstation"),
  catalogTheme("humanity-2006", "Humanity 2006"),
  catalogTheme("pocket-89", "Pocket Handheld 89"),
  catalogTheme("pilot-pda", "Pilot PDA"),
  catalogTheme("clickwheel-pod", "ClickWheel Pod"),
  catalogTheme("station-94", "Station 94"),
  catalogTheme("audioamp-classic", "AudioAMP Classic"),
  catalogTheme("cybercafe-99", "CyberCafe 99"),
  catalogTheme("tiger-aqua", "Tiger Aqua"),
  catalogTheme("media-station-9", "Media Station 9"),
  catalogTheme("instant-chat-7", "Instant Chat 7"),
  catalogTheme("bbs-dialup", "BBS Dial-Up"),
];

export function resolveCatalogTheme(
  themeId: string,
  loadedTheme: Theme,
): Theme | undefined {
  const catalogTheme = builtinThemeCatalog.find((theme) => theme.id === themeId);
  if (!catalogTheme) return undefined;
  if (loadedTheme.id !== themeId) return catalogTheme;
  if (!catalogTheme.variations?.length) return loadedTheme;

  const loadedVariations = new Map(
    loadedTheme.variations?.map((variation) => [variation.id, variation]),
  );
  return {
    ...catalogTheme,
    variants: loadedTheme.variants,
    variations: catalogTheme.variations.map(
      (variation) => loadedVariations.get(variation.id) ?? variation,
    ),
  };
}
