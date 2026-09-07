import type { Theme, ThemeVariation } from "../types";
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
import { tide } from "./tide";
import { tokyoNight } from "./tokyo-night";
import { xcode } from "./xcode";

export const VOKTTY_VARIATIONS: ThemeVariation[] = [
  {
    id: "default",
    name: "Obsidian",
    description: "Modern Obsidian studio with subtle acrylic transparency and calibrated colors.",
    editorTheme: { dark: "github-dark", light: "github-light" },
    accentColor: "#8b5cf6",
    variants: {
      light: {},
      dark: {},
    },
  },
  {
    id: "fluent",
    name: "Fluent",
    description: "Windows Fluent Desktop theme with Carbon elevation and clean surfaces.",
    editorTheme: { dark: "github-dark", light: "github-light" },
    accentColor: "#8b5cf6",
    variants: {
      dark: fluentDark.variants.dark,
      light: fluentLight.variants.light,
    },
  },
  {
    id: "nord",
    name: "Nord",
    description: nord.description,
    editorTheme: nord.editorTheme,
    accentColor: "#88c0d0",
    variants: nord.variants,
  },
  {
    id: "dracula",
    name: "Dracula",
    description: dracula.description,
    editorTheme: dracula.editorTheme,
    accentColor: "#bd93f9",
    variants: dracula.variants,
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: tokyoNight.description,
    editorTheme: tokyoNight.editorTheme,
    accentColor: "#7aa2f7",
    variants: tokyoNight.variants,
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    description: catppuccin.description,
    editorTheme: catppuccin.editorTheme,
    accentColor: "#cba6f7",
    variants: catppuccin.variants,
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    description: rosePine.description,
    editorTheme: rosePine.editorTheme,
    accentColor: "#ebbcba",
    variants: rosePine.variants,
  },
  {
    id: "everforest",
    name: "Everforest",
    description: everforest.description,
    editorTheme: everforest.editorTheme,
    accentColor: "#a7c080",
    variants: everforest.variants,
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    description: gruvbox.description,
    editorTheme: gruvbox.editorTheme,
    accentColor: "#fe8019",
    variants: gruvbox.variants,
  },
  {
    id: "solarized",
    name: "Solarized",
    description: solarized.description,
    editorTheme: solarized.editorTheme,
    accentColor: "#268bd2",
    variants: solarized.variants,
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    description: kanagawa.description,
    editorTheme: kanagawa.editorTheme,
    accentColor: "#7e9cd8",
    variants: kanagawa.variants,
  },
  {
    id: "kanagawa-dragon",
    name: "Kanagawa Dragon",
    description: kanagawaDragon.description,
    editorTheme: kanagawaDragon.editorTheme,
    accentColor: "#c5a072",
    variants: kanagawaDragon.variants,
  },
  {
    id: "claude",
    name: "Claude",
    description: claude.description,
    editorTheme: claude.editorTheme,
    accentColor: "#d97706",
    variants: claude.variants,
  },
  {
    id: "xcode",
    name: "Xcode",
    description: xcode.description,
    editorTheme: xcode.editorTheme,
    accentColor: "#007aff",
    variants: xcode.variants,
  },
  {
    id: "tide",
    name: "Tide",
    description: tide.description,
    editorTheme: tide.editorTheme,
    accentColor: "#06b6d4",
    variants: tide.variants,
  },
  {
    id: "sage",
    name: "Sage",
    description: sage.description,
    editorTheme: sage.editorTheme,
    accentColor: "#10b981",
    variants: sage.variants,
  },
  {
    id: "caffeine",
    name: "Caffeine",
    description: caffeine.description,
    editorTheme: caffeine.editorTheme,
    accentColor: "#b45309",
    variants: caffeine.variants,
  },
];

export const vokttyDefault: Theme = {
  id: "voktty-default",
  name: "Voktty",
  description: "Unified Voktty theme with curated color variations.",
  editorTheme: { dark: "github-dark", light: "github-light" },
  defaultVariation: "default",
  variations: VOKTTY_VARIATIONS,
  variants: {
    light: {},
    dark: {},
  },
};

