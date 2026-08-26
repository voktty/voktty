import type { LanguageId } from "./types";

export type TextDirection = "ltr" | "rtl";

export const FAST_PATH_LANGUAGE_KEY = "voktty-ui-language-shadow";
export const FAST_PATH_DIRECTION_KEY = "voktty-ui-direction-shadow";

const RTL_LOCALES = new Set<LanguageId>(["ar"]);

/**
 * Returns whether the given locale uses right-to-left direction.
 */
export function isRtlLocale(lang: LanguageId | string | null | undefined): boolean {
  if (!lang) return false;
  return RTL_LOCALES.has(lang as LanguageId);
}

/**
 * Resolves the CSS/HTML direction attribute ("ltr" or "rtl") for a given locale.
 */
export function getLocaleDirection(
  lang: LanguageId | string | null | undefined,
): TextDirection {
  return isRtlLocale(lang) ? "rtl" : "ltr";
}

/**
 * Reads fast cached language from localStorage if available.
 */
export function readFastLanguage(fallback: LanguageId = "en"): LanguageId {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(FAST_PATH_LANGUAGE_KEY);
    return (v as LanguageId) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Applies the language and text direction attributes to the document root element,
 * and caches it in localStorage for fast bootstrap on subsequent runs.
 */
export function applyDocumentLocale(
  lang: LanguageId | string | null | undefined,
): void {
  if (typeof document === "undefined") return;
  const resolvedLang = (lang as LanguageId) || "en";
  const direction = getLocaleDirection(resolvedLang);

  document.documentElement.lang = resolvedLang;
  document.documentElement.dir = direction;
  document.documentElement.setAttribute("data-direction", direction);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(FAST_PATH_LANGUAGE_KEY, resolvedLang);
      window.localStorage.setItem(FAST_PATH_DIRECTION_KEY, direction);
    } catch {
      /* ignore storage errors */
    }
  }
}
