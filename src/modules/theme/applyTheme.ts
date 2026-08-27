import type { Theme, ThemeColors, ThemeMode, TerminalPalette } from "./types";

const COLOR_VAR: Record<keyof ThemeColors, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
  radius: "--radius",
  surfaceCanvas: "--surface-canvas",
  surfaceSidebar: "--surface-sidebar",
  surfaceToolbar: "--surface-toolbar",
  surfaceCard: "--surface-card",
  surfacePane: "--surface-pane",
  surfaceHeader: "--surface-header",
  surfacePopover: "--surface-popover",
  surfaceActiveItem: "--surface-active-item",
  accentAction: "--accent-action",
  accentIndicator: "--accent-indicator",
  borderSubtle: "--border-subtle",
};

const ANSI_VARS: readonly string[] = [
  "--terminal-ansi-black",
  "--terminal-ansi-red",
  "--terminal-ansi-green",
  "--terminal-ansi-yellow",
  "--terminal-ansi-blue",
  "--terminal-ansi-magenta",
  "--terminal-ansi-cyan",
  "--terminal-ansi-white",
  "--terminal-ansi-bright-black",
  "--terminal-ansi-bright-red",
  "--terminal-ansi-bright-green",
  "--terminal-ansi-bright-yellow",
  "--terminal-ansi-bright-blue",
  "--terminal-ansi-bright-magenta",
  "--terminal-ansi-bright-cyan",
  "--terminal-ansi-bright-white",
];

const ALL_VARS: readonly string[] = [
  ...Object.values(COLOR_VAR),
  "--frame",
  "--terminal-background",
  "--terminal-foreground",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-selection",
  ...ANSI_VARS,
];

let lastApplied: string | null = null;

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const root = document.documentElement;
  const variant = theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  if (!variant) {
    clearTheme();
    return;
  }
  const colors = variant.colors;
  const terminal = variant.terminal;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  if (colors) writeColors(root, colors);
  if (terminal) writeTerminal(root, terminal);
  lastApplied = theme.id;
}

export function clearTheme(): void {
  if (lastApplied === null) return;
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  lastApplied = null;
}

function writeColors(root: HTMLElement, c: ThemeColors): void {
  for (const k of Object.keys(c) as (keyof ThemeColors)[]) {
    const v = c[k];
    if (v) {
      root.style.setProperty(COLOR_VAR[k], v);
    }
  }

  // Synchronize derived fallback variables if not explicitly provided
  const bg = c.background ?? "#121214";
  const fg = c.foreground ?? "#f4f4f6";
  const frame = c.surfaceToolbar ?? c.sidebar ?? bg;
  const termBg = c.surfacePane ?? c.card ?? bg;
  const borderSubtle = c.borderSubtle ?? c.border ?? "rgba(255, 255, 255, 0.07)";

  root.style.setProperty("--frame", frame);
  root.style.setProperty("--border-subtle", borderSubtle);

  if (!c.surfaceCanvas) root.style.setProperty("--surface-canvas", bg);
  if (!c.surfaceSidebar) root.style.setProperty("--surface-sidebar", c.sidebar ?? bg);
  if (!c.surfaceToolbar) root.style.setProperty("--surface-toolbar", frame);
  if (!c.surfaceCard) root.style.setProperty("--surface-card", c.card ?? bg);
  if (!c.surfacePane) root.style.setProperty("--surface-pane", termBg);
  if (!c.surfacePopover) root.style.setProperty("--surface-popover", c.popover ?? c.card ?? bg);
  if (!c.surfaceActiveItem) root.style.setProperty("--surface-active-item", c.accent ?? "rgba(255, 255, 255, 0.08)");

  // Default terminal bindings from palette
  root.style.setProperty("--terminal-background", termBg);
  root.style.setProperty("--terminal-foreground", fg);
  root.style.setProperty("--terminal-cursor", c.primary ?? fg);
  root.style.setProperty("--terminal-cursor-accent", termBg);
  root.style.setProperty("--terminal-selection", c.accent ?? "rgba(99, 102, 241, 0.28)");
}

function writeTerminal(root: HTMLElement, t: TerminalPalette): void {
  if (t.background) root.style.setProperty("--terminal-background", t.background);
  if (t.foreground) root.style.setProperty("--terminal-foreground", t.foreground);
  if (t.cursor) root.style.setProperty("--terminal-cursor", t.cursor);
  if (t.cursorAccent) root.style.setProperty("--terminal-cursor-accent", t.cursorAccent);
  if (t.selection) root.style.setProperty("--terminal-selection", t.selection);
  if (t.ansi) {
    for (let i = 0; i < ANSI_VARS.length && i < t.ansi.length; i++) {
      root.style.setProperty(ANSI_VARS[i], t.ansi[i]);
    }
  }
}
