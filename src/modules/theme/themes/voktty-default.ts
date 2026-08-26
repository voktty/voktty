import type { Theme } from "../types";

/**
 * Colours live in `styles/globals.css` (`:root` / `.dark`), not here:
 * ThemeProvider calls `clearTheme()` for this id instead of `applyTheme`, so
 * anything declared in `variants` would be dead and would drift. Empty
 * variants also let the settings swatch fall back to the live CSS vars.
 */
export const vokttyDefault: Theme = {
  id: "voktty-default",
  name: "Voktty Default",
  description: "Modern Obsidian studio with subtle acrylic transparency and calibrated colors.",
  editorTheme: { dark: "github-dark", light: "github-light" },
  variants: {
    light: {},
    dark: {},
  },
};
