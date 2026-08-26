import type { Theme } from "../types";

export const tide: Theme = {
  id: "tide",
  name: "Tide",
  description: "Abyssal slate with luminous oceanic neon teal.",
  editorTheme: { dark: "nord", light: "github-light" },
  variants: {
    dark: {
      colors: {
        // Fondos con mayor contraste y sensación de profundidad (Dark Abyss)
        background: "#0b0f14",
        foreground: "#dbe8ee",
        card: "#121820",
        cardForeground: "#dbe8ee",
        popover: "#151d27",
        popoverForeground: "#dbe8ee",
        // Primario: Turquesa brillante "Bioluminescent Tide"
        primary: "#38dbca",
        primaryForeground: "#061217",
        secondary: "#16202a",
        secondaryForeground: "#c5d7e0",
        muted: "#16202a",
        mutedForeground: "#7891a0",
        accent: "#192934",
        accentForeground: "#38dbca",
        // Destructive / Errores: Rojo coral de alto impacto
        destructive: "#ff5370",
        border: "rgba(180, 215, 230, 0.10)",
        input: "rgba(180, 215, 230, 0.14)",
        ring: "#38dbca",
        sidebar: "#080c10",
        sidebarForeground: "#dbe8ee",
        sidebarPrimary: "#38dbca",
        sidebarPrimaryForeground: "#061217",
        sidebarAccent: "#131e28",
        sidebarAccentForeground: "#dbe8ee",
        sidebarBorder: "rgba(180, 215, 230, 0.08)",
        sidebarRing: "#38dbca",
        radius: "0.5rem",
      },
      terminal: {
        // Cursor y selección con brillo y visibilidad premium
        cursor: "#38dbca",
        cursorAccent: "#0b0f14",
        selection: "rgba(56, 219, 202, 0.22)",
        ansi: [
          // ── Colores Estándar (0-7) ──
          "#1a232c", // Black (fondos de bloques/badges)
          "#ff5370", // Red (errores de compilación / git deleted)
          "#3dd68c", // Green (tests passing / git added / strings)
          "#ffcb6b", // Yellow (warnings / types / numbers)
          "#4ba3e3", // Blue (directorios / funciones)
          "#be8aeb", // Magenta (keywords / imports / operators)
          "#38dbca", // Cyan (firma Tide / variables especiales)
          "#dbe8ee", // White (texto principal)

          // ── Colores Bright / High Intensity (8-15) ──
          "#526978", // Bright Black (Comentarios y texto atenuado - ¡MUY LEGIBLE!)
          "#ff6b84", // Bright Red (alertas críticas)
          "#5cf2a5", // Bright Green (éxitos destacados)
          "#ffe082", // Bright Yellow (resaltados)
          "#6cbdfa", // Bright Blue (enlaces / rutas)
          "#d2a6ff", // Bright Magenta (decoradores / constantes)
          "#5eead4", // Bright Cyan (tokens activos / prompts)
          "#f1f7fa", // Bright White (máximo contraste)
        ],
      },
    },
    light: {
      colors: {
        background: "#f0f5f7",
        foreground: "#1f2d38",
        card: "#ffffff",
        cardForeground: "#1f2d38",
        popover: "#ffffff",
        popoverForeground: "#1f2d38",
        primary: "#14867c",
        primaryForeground: "#ffffff",
        secondary: "#e0ecef",
        secondaryForeground: "#1f2d38",
        muted: "#e3edf0",
        mutedForeground: "#5c7382",
        accent: "#dbe8eb",
        accentForeground: "#14867c",
        destructive: "#d9383a",
        border: "rgba(31, 45, 56, 0.12)",
        input: "rgba(31, 45, 56, 0.16)",
        ring: "#14867c",
        sidebar: "#e6eff2",
        sidebarForeground: "#1f2d38",
        sidebarPrimary: "#14867c",
        sidebarPrimaryForeground: "#ffffff",
        sidebarAccent: "#dbe8eb",
        sidebarAccentForeground: "#1f2d38",
        sidebarBorder: "rgba(31, 45, 56, 0.10)",
        sidebarRing: "#14867c",
        radius: "0.5rem",
      },
      terminal: {
        cursor: "#14867c",
        cursorAccent: "#f0f5f7",
        selection: "rgba(20, 134, 124, 0.18)",
        ansi: [
          "#1f2d38", "#d9383a", "#228b53", "#9e6a03",
          "#20639b", "#83449e", "#14867c", "#c2d2d9",
          "#667d8d", "#e64d50", "#2ea666", "#ba8211",
          "#2d78b8", "#9a5bb7", "#1aa397", "#0e1820",
        ],
      },
    },
  },
};