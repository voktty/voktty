import type { ThemeVariation } from "../types";

export const liquid: ThemeVariation = {
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
};
