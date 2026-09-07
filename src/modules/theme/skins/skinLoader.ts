import type { SkinFontDefinition, ThemeSkin } from "../types";

export const SKIN_STYLE_ELEMENT_ID = "voktty-skin-styles";

/**
 * Scopes a single CSS selector to `[data-theme-skin="<skinId>"]`.
 */
export function scopeSelector(skinId: string, selector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return "";
  const skinAttr = `[data-theme-skin="${skinId}"]`;

  if (trimmed.includes(skinAttr)) {
    return trimmed;
  }
  if (trimmed === ":root" || trimmed === "html") {
    return `${trimmed}${skinAttr}`;
  }
  if (trimmed.startsWith(":root") || trimmed.startsWith("html")) {
    return trimmed.replace(/^(:root|html)/, `$1${skinAttr}`);
  }
  if (trimmed.startsWith("body")) {
    return `${skinAttr} ${trimmed}`;
  }
  return `${skinAttr} ${trimmed}`;
}

/**
 * Splits a comma-separated selector list respecting brackets and parentheses.
 */
export function splitSelectors(selectorList: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString: "'" | '"' | null = null;

  for (let i = 0; i < selectorList.length; i++) {
    const char = selectorList[i];
    if (inString) {
      current += char;
      if (char === inString && selectorList[i - 1] !== "\\") {
        inString = null;
      }
    } else if (char === "'" || char === '"') {
      inString = char;
      current += char;
    } else if (char === "(") {
      parenDepth++;
      current += char;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
    } else if (char === "[") {
      bracketDepth++;
      current += char;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
    } else if (char === "," && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) selectors.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

/**
 * Transforms all rules in `rawCss` so every rule is scoped to `[data-theme-skin="<skinId>"]`.
 * Preserves `@font-face` and `@keyframes` at-rules untouched.
 */
export function scopeSkinCss(skinId: string, rawCss: string): string {
  if (!rawCss || !skinId) return "";

  let result = "";
  let i = 0;
  const len = rawCss.length;

  while (i < len) {
    const nextOpen = rawCss.indexOf("{", i);
    if (nextOpen === -1) {
      const rest = rawCss.slice(i).trim();
      if (rest) result += rest;
      break;
    }

    const preamble = rawCss.slice(i, nextOpen).trim();
    
    let depth = 1;
    let j = nextOpen + 1;
    let inString: "'" | '"' | null = null;

    while (j < len && depth > 0) {
      const c = rawCss[j];
      if (inString) {
        if (c === inString && rawCss[j - 1] !== "\\") inString = null;
      } else if (c === "'" || c === '"') {
        inString = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      }
      j++;
    }

    const blockContent = rawCss.slice(nextOpen + 1, j - 1);
    i = j;

    if (preamble.startsWith("@font-face") || preamble.startsWith("@keyframes")) {
      result += `${preamble} {${blockContent}}\n`;
    } else if (preamble.startsWith("@media") || preamble.startsWith("@supports") || preamble.startsWith("@layer")) {
      const scopedInner = scopeSkinCss(skinId, blockContent);
      result += `${preamble} {\n${scopedInner}}\n`;
    } else {
      const selectors = splitSelectors(preamble);
      const scopedSelector = selectors
        .map((s) => scopeSelector(skinId, s))
        .join(", ");
      result += `${scopedSelector} {${blockContent}}\n`;
    }
  }

  return result.trim();
}

/**
 * Validates whether the given skin CSS is safe and properly scoped.
 */
export function validateSkinCss(
  skinId: string,
  rawCss: string,
): { valid: boolean; errors: string[]; scopedCss: string } {
  const errors: string[] = [];
  if (!skinId) {
    errors.push("Skin ID is required");
    return { valid: false, errors, scopedCss: "" };
  }

  const scopedCss = scopeSkinCss(skinId, rawCss);
  return {
    valid: errors.length === 0,
    errors,
    scopedCss,
  };
}

/**
 * Generates `@font-face` CSS declarations from an array of font definitions.
 */
export function generateFontFaces(fonts?: SkinFontDefinition[]): string {
  if (!fonts || fonts.length === 0) return "";
  return fonts
    .map((f) => {
      const weight = f.weight ? `  font-weight: ${f.weight};\n` : "";
      const style = f.style ? `  font-style: ${f.style};\n` : "";
      const display = f.display ? `  font-display: ${f.display};\n` : "  font-display: swap;\n";
      return `@font-face {\n  font-family: '${f.family}';\n  src: ${f.src};\n${weight}${style}${display}}`;
    })
    .join("\n\n");
}

/**
 * Injects skin styles and font declarations into document head.
 */
export function injectSkinStyles(
  skinId: string,
  css: string,
  fonts?: SkinFontDefinition[],
): void {
  if (typeof document === "undefined" || typeof document.getElementById !== "function" || !document.head) return;

  const scopedCss = scopeSkinCss(skinId, css);
  const fontFaces = generateFontFaces(fonts);
  const fullContent = [fontFaces, scopedCss].filter(Boolean).join("\n\n");

  let el = document.getElementById(SKIN_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = SKIN_STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }

  el.dataset.skinId = skinId;
  el.textContent = fullContent;
}

/**
 * Removes the injected skin stylesheet element.
 */
export function removeSkinStyles(): void {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
  const el = document.getElementById(SKIN_STYLE_ELEMENT_ID);
  if (el) {
    el.remove();
  }
}

/**
 * Applies a skin to the document, stamping `data-theme-skin` and injecting styles.
 */
export function applySkin(skin: ThemeSkin): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.setAttribute("data-theme-skin", skin.id);
  injectSkinStyles(skin.id, skin.css, skin.fonts);
}

/**
 * Clears the active skin, removing `data-theme-skin` and removing styles.
 */
export function clearSkin(): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.removeAttribute("data-theme-skin");
  removeSkinStyles();
}
