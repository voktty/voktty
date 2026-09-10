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
    id: "liquid",
    name: "Liquid",
    description: "Adaptive glass navigation with focused, solid work surfaces.",
    editorTheme: { dark: "github-dark", light: "github-light" },
    accentColor: "#0a84ff",
    variants: {
      light: {
        colors: {
          background: "#f5f5f7", foreground: "#1d1d1f", card: "#ffffff", cardForeground: "#1d1d1f",
          popover: "#ffffff", popoverForeground: "#1d1d1f", primary: "#0a84ff", primaryForeground: "#ffffff",
          secondary: "#e9e9ed", secondaryForeground: "#1d1d1f", muted: "#ececf0", mutedForeground: "#6e6e73",
          accent: "#dfe9f8", accentForeground: "#1d1d1f", destructive: "#ff453a", border: "rgba(0, 0, 0, 0.12)",
          input: "rgba(0, 0, 0, 0.14)", ring: "#0a84ff", sidebar: "#ececf0", sidebarForeground: "#1d1d1f",
          sidebarPrimary: "#0a84ff", sidebarPrimaryForeground: "#ffffff", sidebarAccent: "#dfe9f8",
          sidebarAccentForeground: "#1d1d1f", sidebarBorder: "rgba(0, 0, 0, 0.10)", sidebarRing: "#0a84ff",
          radius: "0.625rem", surfaceCanvas: "#f5f5f7", surfaceSidebar: "#ececf0", surfaceToolbar: "#f7f7f9",
          surfaceCard: "#ffffff", surfacePane: "#ffffff", surfaceHeader: "#ececf0", surfacePopover: "#ffffff",
          surfaceActiveItem: "#dfe9f8", accentAction: "#0a84ff", accentIndicator: "#0a84ff", borderSubtle: "rgba(0, 0, 0, 0.10)",
        },
      },
      dark: {
        colors: {
          background: "#1c1c1e", foreground: "#f5f5f7", card: "#2c2c2e", cardForeground: "#f5f5f7",
          popover: "#303034", popoverForeground: "#f5f5f7", primary: "#0a84ff", primaryForeground: "#ffffff",
          secondary: "#2c2c2e", secondaryForeground: "#f5f5f7", muted: "#252527", mutedForeground: "#aeaeb2",
          accent: "#3a4b63", accentForeground: "#f5f5f7", destructive: "#ff453a", border: "rgba(255, 255, 255, 0.14)",
          input: "rgba(255, 255, 255, 0.16)", ring: "#0a84ff", sidebar: "#252527", sidebarForeground: "#f5f5f7",
          sidebarPrimary: "#0a84ff", sidebarPrimaryForeground: "#ffffff", sidebarAccent: "#3a4b63",
          sidebarAccentForeground: "#f5f5f7", sidebarBorder: "rgba(255, 255, 255, 0.12)", sidebarRing: "#0a84ff",
          radius: "0.625rem", surfaceCanvas: "#1c1c1e", surfaceSidebar: "#252527", surfaceToolbar: "#28282a",
          surfaceCard: "#2c2c2e", surfacePane: "#2c2c2e", surfaceHeader: "#28282a", surfacePopover: "#303034",
          surfaceActiveItem: "#3a4b63", accentAction: "#0a84ff", accentIndicator: "#0a84ff", borderSubtle: "rgba(255, 255, 255, 0.12)",
        },
      },
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
