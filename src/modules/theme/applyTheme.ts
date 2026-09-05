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

const EXTRA_VARS: readonly string[] = [
  "--frame",
  "--vibrancy-opacity",
  "--terminal-background",
  "--terminal-foreground",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-selection",
  "--background-base",
  "--color-background-base",
  "--content",
  "--color-content",
  "--background-lightness",
  "--content-lightness",
];

const ALL_VARS: readonly string[] = [
  ...Object.values(COLOR_VAR),
  ...EXTRA_VARS,
  ...ANSI_VARS,
];

export function isDarkColor(color: string): boolean {
  if (!color || color === "transparent") return true;
  const trimmed = color.trim().toLowerCase();
  let r = 0;
  let g = 0;
  let b = 0;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    r = Number.parseInt(trimmed[1] + trimmed[1], 16);
    g = Number.parseInt(trimmed[2] + trimmed[2], 16);
    b = Number.parseInt(trimmed[3] + trimmed[3], 16);
  } else if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    r = Number.parseInt(trimmed.slice(1, 3), 16);
    g = Number.parseInt(trimmed.slice(3, 5), 16);
    b = Number.parseInt(trimmed.slice(5, 7), 16);
  } else {
    const match = trimmed.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i,
    );
    if (match) {
      r = Number.parseInt(match[1], 10);
      g = Number.parseInt(match[2], 10);
      b = Number.parseInt(match[3], 10);
    } else {
      return true;
    }
  }
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
}

export function colorWithAlpha(color: string, alpha: number): string {
  if (!color || color === "transparent") return "transparent";
  const trimmed = color.trim();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = Number.parseInt(trimmed[1] + trimmed[1], 16);
    const g = Number.parseInt(trimmed[2] + trimmed[2], 16);
    const b = Number.parseInt(trimmed[3] + trimmed[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    const r = Number.parseInt(trimmed.slice(1, 3), 16);
    const g = Number.parseInt(trimmed.slice(3, 5), 16);
    const b = Number.parseInt(trimmed.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
  }
  const rgbMatch = trimmed.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i,
  );
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${Number(alpha.toFixed(3))})`;
  }
  const rgbaMatch = trimmed.match(
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([0-9.]+)\s*\)$/i,
  );
  if (rgbaMatch) {
    const origAlpha = Number.parseFloat(rgbaMatch[4]);
    const finalAlpha = Math.min(1, Math.max(0, origAlpha * alpha));
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${Number(finalAlpha.toFixed(3))})`;
  }
  return color;
}

let lastAppliedKey: string | null = null;

export function applyTheme(
  theme: Theme,
  mode: ThemeMode,
  vibrancyEnabled = false,
  vibrancyOpacity = 0.85,
): void {
  const root = document.documentElement;
  const variant =
    theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  if (
    !variant ||
    (Object.keys(variant.colors ?? {}).length === 0 && !variant.terminal)
  ) {
    clearTheme();
    if (vibrancyEnabled) {
      root.style.setProperty("--vibrancy-opacity", String(vibrancyOpacity));
    }
    return;
  }
  const colors = variant.colors;
  const terminal = variant.terminal;
  for (const v of ALL_VARS) root.style.removeProperty(v);

  const isDark = colors?.background
    ? isDarkColor(colors.background)
    : theme.variants[mode]
      ? mode === "dark"
      : Boolean(theme.variants.dark);

  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
  root.classList.toggle("theme-light", !isDark);

  if (colors) writeColors(root, colors, vibrancyEnabled, vibrancyOpacity, isDark);
  if (terminal) writeTerminal(root, terminal, vibrancyEnabled);
  lastAppliedKey = `${theme.id}:${mode}:${vibrancyEnabled}:${vibrancyOpacity}`;
}

export function clearTheme(): void {
  if (lastAppliedKey === null) return;
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  lastAppliedKey = null;
}

function writeColors(
  root: HTMLElement,
  c: ThemeColors,
  vibrancyEnabled: boolean,
  vibrancyOpacity: number,
  isDark: boolean,
): void {
  for (const k of Object.keys(c) as (keyof ThemeColors)[]) {
    const v = c[k];
    if (v) {
      root.style.setProperty(COLOR_VAR[k], v);
    }
  }

  const bg = c.background ?? (isDark ? "#121214" : "#fafafc");
  const fg = c.foreground ?? (isDark ? "#f4f4f6" : "#18191c");
  const rawFrame = c.surfaceToolbar ?? c.sidebar ?? bg;
  const rawTermBg = c.surfacePane ?? c.card ?? bg;
  const borderSubtle =
    c.borderSubtle ?? c.border ?? (isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)");

  root.style.setProperty("--border-subtle", borderSubtle);
  root.style.setProperty("--background-base", bg);
  root.style.setProperty("--color-background-base", bg);
  root.style.setProperty("--content", fg);
  root.style.setProperty("--color-content", fg);
  root.style.setProperty("--background-lightness", isDark ? "9%" : "97%");
  root.style.setProperty("--content-lightness", isDark ? "92%" : "18%");

  if (vibrancyEnabled) {
    root.style.setProperty("--vibrancy-opacity", String(vibrancyOpacity));
    const frame = colorWithAlpha(rawFrame, Math.min(1, vibrancyOpacity * 0.55));
    const sidebar = colorWithAlpha(
      c.surfaceSidebar ?? c.sidebar ?? bg,
      Math.min(1, vibrancyOpacity * 0.75),
    );
    const toolbar = colorWithAlpha(
      c.surfaceToolbar ?? rawFrame,
      Math.min(1, vibrancyOpacity * 0.70),
    );
    const card = colorWithAlpha(
      c.surfaceCard ?? c.card ?? bg,
      Math.min(1, vibrancyOpacity * 0.85),
    );
    const popover = colorWithAlpha(
      c.surfacePopover ?? c.popover ?? c.card ?? bg,
      Math.min(1, vibrancyOpacity * 0.95),
    );
    const activeItem = colorWithAlpha(
      c.surfaceActiveItem ?? c.accent ?? (isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"),
      Math.min(1, vibrancyOpacity * 0.80),
    );

    root.style.setProperty("--frame", frame);
    root.style.setProperty("--surface-canvas", "transparent");
    root.style.setProperty("--surface-sidebar", sidebar);
    root.style.setProperty("--surface-toolbar", toolbar);
    root.style.setProperty("--surface-card", card);
    root.style.setProperty("--surface-pane", "transparent");
    root.style.setProperty("--surface-popover", popover);
    root.style.setProperty("--surface-active-item", activeItem);

    root.style.setProperty("--terminal-background", "transparent");
    root.style.setProperty("--terminal-foreground", fg);
    root.style.setProperty("--terminal-cursor", c.primary ?? fg);
    root.style.setProperty("--terminal-cursor-accent", "transparent");
    root.style.setProperty(
      "--terminal-selection",
      c.accent ?? (isDark ? "rgba(99, 102, 241, 0.28)" : "rgba(37, 99, 235, 0.25)"),
    );
  } else {
    root.style.setProperty("--frame", rawFrame);
    if (!c.surfaceCanvas) root.style.setProperty("--surface-canvas", bg);
    if (!c.surfaceSidebar)
      root.style.setProperty("--surface-sidebar", c.sidebar ?? bg);
    if (!c.surfaceToolbar)
      root.style.setProperty("--surface-toolbar", rawFrame);
    if (!c.surfaceCard) root.style.setProperty("--surface-card", c.card ?? bg);
    if (!c.surfacePane) root.style.setProperty("--surface-pane", rawTermBg);
    if (!c.surfacePopover)
      root.style.setProperty("--surface-popover", c.popover ?? c.card ?? bg);
    if (!c.surfaceActiveItem)
      root.style.setProperty(
        "--surface-active-item",
        c.accent ?? (isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"),
      );

    root.style.setProperty("--terminal-background", rawTermBg);
    root.style.setProperty("--terminal-foreground", fg);
    root.style.setProperty("--terminal-cursor", c.primary ?? fg);
    root.style.setProperty("--terminal-cursor-accent", rawTermBg);
    root.style.setProperty(
      "--terminal-selection",
      c.accent ?? (isDark ? "rgba(99, 102, 241, 0.28)" : "rgba(37, 99, 235, 0.25)"),
    );
  }
}

function writeTerminal(
  root: HTMLElement,
  t: TerminalPalette,
  vibrancyEnabled: boolean,
): void {
  if (t.background && !vibrancyEnabled) {
    root.style.setProperty("--terminal-background", t.background);
  }
  if (t.foreground) root.style.setProperty("--terminal-foreground", t.foreground);
  if (t.cursor) root.style.setProperty("--terminal-cursor", t.cursor);
  if (t.cursorAccent)
    root.style.setProperty(
      "--terminal-cursor-accent",
      vibrancyEnabled ? "transparent" : t.cursorAccent,
    );
  if (t.selection) root.style.setProperty("--terminal-selection", t.selection);
  if (t.ansi) {
    for (let i = 0; i < ANSI_VARS.length && i < t.ansi.length; i++) {
      if (i === 0 && vibrancyEnabled) {
        root.style.setProperty(ANSI_VARS[0], "transparent");
      } else {
        root.style.setProperty(ANSI_VARS[i], t.ansi[i]);
      }
    }
  } else if (vibrancyEnabled) {
    root.style.setProperty(ANSI_VARS[0], "transparent");
  }
}
