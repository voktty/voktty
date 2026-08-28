export type TerminalTokens = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  ansiBlack: string;
  ansiRed: string;
  ansiGreen: string;
  ansiYellow: string;
  ansiBlue: string;
  ansiMagenta: string;
  ansiCyan: string;
  ansiWhite: string;
  ansiBrightBlack: string;
  ansiBrightRed: string;
  ansiBrightGreen: string;
  ansiBrightYellow: string;
  ansiBrightBlue: string;
  ansiBrightMagenta: string;
  ansiBrightCyan: string;
  ansiBrightWhite: string;
};

const VAR_BY_KEY: Record<keyof TerminalTokens, string> = {
  background: "--terminal-background",
  foreground: "--terminal-foreground",
  cursor: "--terminal-cursor",
  cursorAccent: "--terminal-cursor-accent",
  selection: "--terminal-selection",
  ansiBlack: "--terminal-ansi-black",
  ansiRed: "--terminal-ansi-red",
  ansiGreen: "--terminal-ansi-green",
  ansiYellow: "--terminal-ansi-yellow",
  ansiBlue: "--terminal-ansi-blue",
  ansiMagenta: "--terminal-ansi-magenta",
  ansiCyan: "--terminal-ansi-cyan",
  ansiWhite: "--terminal-ansi-white",
  ansiBrightBlack: "--terminal-ansi-bright-black",
  ansiBrightRed: "--terminal-ansi-bright-red",
  ansiBrightGreen: "--terminal-ansi-bright-green",
  ansiBrightYellow: "--terminal-ansi-bright-yellow",
  ansiBrightBlue: "--terminal-ansi-bright-blue",
  ansiBrightMagenta: "--terminal-ansi-bright-magenta",
  ansiBrightCyan: "--terminal-ansi-bright-cyan",
  ansiBrightWhite: "--terminal-ansi-bright-white",
};

const KEYS = Object.keys(VAR_BY_KEY) as (keyof TerminalTokens)[];

let probe: HTMLDivElement | null = null;

function getProbe(): HTMLDivElement {
  if (probe?.isConnected) return probe;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;contain:strict;width:0;height:0;";
  document.body.appendChild(el);
  probe = el;
  return el;
}

/**
 * Resolve a CSS variable value recursively across var(--x) references,
 * preserving transparent and translucent rgba/hsla values.
 */
function resolveCssVarRaw(varName: string, depth = 0): string {
  if (depth > 6 || typeof document === "undefined") return "";
  let val = document.documentElement.style.getPropertyValue(varName).trim();
  if (!val) {
    val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }
  if (val.startsWith("var(") && val.endsWith(")")) {
    const inner = val.slice(4, -1).trim();
    const comma = inner.indexOf(",");
    if (comma !== -1) {
      const innerVar = inner.slice(0, comma).trim();
      const fallback = inner.slice(comma + 1).trim();
      const resolved = resolveCssVarRaw(innerVar, depth + 1);
      return resolved || fallback;
    }
    return resolveCssVarRaw(inner, depth + 1);
  }
  return val;
}

function resolveColor(el: HTMLDivElement, varName: string): string {
  el.style.color = `var(${varName})`;
  return getComputedStyle(el).color;
}

const ALPHA_KEYS = new Set<keyof TerminalTokens>([
  "background",
  "selection",
  "cursorAccent",
  "ansiBlack",
]);

export function readTerminalTokens(): TerminalTokens {
  const el = getProbe();
  const out = {} as TerminalTokens;
  for (const k of KEYS) {
    if (ALPHA_KEYS.has(k)) {
      const raw = resolveCssVarRaw(VAR_BY_KEY[k]);
      out[k] = raw || resolveColor(el, VAR_BY_KEY[k]);
    } else {
      out[k] = resolveColor(el, VAR_BY_KEY[k]);
    }
  }
  return out;
}
