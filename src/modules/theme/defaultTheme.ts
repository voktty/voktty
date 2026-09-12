import type { Theme } from "./types";

export const defaultTheme: Theme = {
  id: "voktty-default",
  name: "Voktty",
  editorTheme: { dark: "github-dark", light: "github-light" },
  defaultVariation: "default",
  variants: { light: {}, dark: {} },
  variations: [{
    id: "default",
    name: "Obsidian",
    editorTheme: { dark: "github-dark", light: "github-light" },
    accentColor: "#8b5cf6",
    variants: { light: {}, dark: {} },
  }],
};
