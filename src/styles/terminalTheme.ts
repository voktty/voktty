import { readTerminalTokens } from "@/styles/tokens";
import type { ITheme } from "@xterm/xterm";

/**
 * Normalise any CSS color value into a format that xterm's `css.toColor`
 * parser accepts without throwing (#rgb, #rrggbb, #rrggbbaa, rgb, rgba, transparent).
 */
function toXtermColor(color: string, fallback: string): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  if (trimmed === "transparent") return "rgba(0, 0, 0, 0)";
  if (/^#([0-9a-f]{3,8})$/i.test(trimmed)) return trimmed;
  if (
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|\d*(?:\.\d+)?))?\s*\)$/i.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  return fallback;
}

export function buildTerminalTheme(): ITheme {
  const isVibrancy =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-vibrancy") === "on";
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("light");
  const t = readTerminalTokens();

  const bgFallback = isVibrancy
    ? isLight
      ? "rgba(255, 255, 255, 0.84)"
      : "rgba(0, 0, 0, 0)"
    : isLight
      ? "#f4f5f8"
      : "#0b0f19";
  const fgFallback = isLight ? "#18191c" : "#f8fafc";

  const bg =
    isVibrancy && !isLight &&
    (!t.background ||
      t.background === "transparent" ||
      t.background === "rgba(0, 0, 0, 0)")
      ? "rgba(0, 0, 0, 0)"
      : toXtermColor(t.background, bgFallback);
  const fg = toXtermColor(t.foreground, fgFallback);
  const cursor = toXtermColor(t.cursor, isLight ? "#0284c7" : "#10b981");
  const cursorAccent = toXtermColor(t.cursorAccent, isLight ? "#ffffff" : "#0b0f19");
  const selection = toXtermColor(
    t.selection,
    isLight ? "rgba(37, 99, 235, 0.20)" : "rgba(99, 102, 241, 0.28)",
  );

  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent,
    selectionBackground: selection,
    black: toXtermColor(t.ansiBlack, isLight ? "#18191c" : "#1e293b"),
    red: toXtermColor(t.ansiRed, isLight ? "#b91c1c" : "#f87171"),
    green: toXtermColor(t.ansiGreen, isLight ? "#15803d" : "#10b981"),
    yellow: toXtermColor(t.ansiYellow, isLight ? "#b45309" : "#fbbf24"),
    blue: toXtermColor(t.ansiBlue, isLight ? "#1d4ed8" : "#6366f1"),
    magenta: toXtermColor(t.ansiMagenta, isLight ? "#7e22ce" : "#a855f7"),
    cyan: toXtermColor(t.ansiCyan, isLight ? "#0e7490" : "#38bdf8"),
    white: toXtermColor(t.ansiWhite, isLight ? "#4b5563" : "#e2e8f0"),
    brightBlack: toXtermColor(t.ansiBrightBlack, isLight ? "#4b5563" : "#475569"),
    brightRed: toXtermColor(t.ansiBrightRed, isLight ? "#dc2626" : "#fca5a5"),
    brightGreen: toXtermColor(t.ansiBrightGreen, isLight ? "#16a34a" : "#34d399"),
    brightYellow: toXtermColor(t.ansiBrightYellow, isLight ? "#ca8a04" : "#fde047"),
    brightBlue: toXtermColor(t.ansiBrightBlue, isLight ? "#2563eb" : "#818cf8"),
    brightMagenta: toXtermColor(t.ansiBrightMagenta, isLight ? "#9333ea" : "#c084fc"),
    brightCyan: toXtermColor(t.ansiBrightCyan, isLight ? "#0891b2" : "#7dd3fc"),
    brightWhite: toXtermColor(t.ansiBrightWhite, isLight ? "#0f172a" : "#ffffff"),
  };
}
