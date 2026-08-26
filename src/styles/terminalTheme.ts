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
  const t = readTerminalTokens();

  const bg = toXtermColor(t.background, "#0b0f19");
  const fg = toXtermColor(t.foreground, "#f8fafc");
  const cursor = toXtermColor(t.cursor, "#10b981");
  const cursorAccent = toXtermColor(t.cursorAccent, "#0b0f19");
  const selection = toXtermColor(t.selection, "rgba(99, 102, 241, 0.28)");

  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent,
    selectionBackground: selection,
    black: toXtermColor(t.ansiBlack, "#1e293b"),
    red: toXtermColor(t.ansiRed, "#f87171"),
    green: toXtermColor(t.ansiGreen, "#10b981"),
    yellow: toXtermColor(t.ansiYellow, "#fbbf24"),
    blue: toXtermColor(t.ansiBlue, "#6366f1"),
    magenta: toXtermColor(t.ansiMagenta, "#a855f7"),
    cyan: toXtermColor(t.ansiCyan, "#38bdf8"),
    white: toXtermColor(t.ansiWhite, "#e2e8f0"),
    brightBlack: toXtermColor(t.ansiBrightBlack, "#475569"),
    brightRed: toXtermColor(t.ansiBrightRed, "#fca5a5"),
    brightGreen: toXtermColor(t.ansiBrightGreen, "#34d399"),
    brightYellow: toXtermColor(t.ansiBrightYellow, "#fde047"),
    brightBlue: toXtermColor(t.ansiBrightBlue, "#818cf8"),
    brightMagenta: toXtermColor(t.ansiBrightMagenta, "#c084fc"),
    brightCyan: toXtermColor(t.ansiBrightCyan, "#7dd3fc"),
    brightWhite: toXtermColor(t.ansiBrightWhite, "#ffffff"),
  };
}
