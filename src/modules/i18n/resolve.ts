import { interpolate } from "./interpolate";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { pt } from "./locales/pt";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { it } from "./locales/it";
import { zh } from "./locales/zh";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { ru } from "./locales/ru";
import { hi } from "./locales/hi";
import { ar } from "./locales/ar";
import type { LanguageId, TranslationParams } from "./types";

const LOCALES: Record<LanguageId, Record<string, unknown>> = {
  en: en as unknown as Record<string, unknown>,
  es: es as unknown as Record<string, unknown>,
  pt: pt as unknown as Record<string, unknown>,
  fr: fr as unknown as Record<string, unknown>,
  de: de as unknown as Record<string, unknown>,
  it: it as unknown as Record<string, unknown>,
  zh: zh as unknown as Record<string, unknown>,
  ja: ja as unknown as Record<string, unknown>,
  ko: ko as unknown as Record<string, unknown>,
  ru: ru as unknown as Record<string, unknown>,
  hi: hi as unknown as Record<string, unknown>,
  ar: ar as unknown as Record<string, unknown>,
};

function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      !(part in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function translate(
  lang: LanguageId,
  key: string,
  params?: TranslationParams,
): string {
  const targetDict = LOCALES[lang] ?? LOCALES.en;
  let str = getNestedValue(targetDict, key);
  if (str === undefined && lang !== "en") {
    str = getNestedValue(LOCALES.en, key);
  }
  if (str === undefined) {
    const defaultValue = params?.defaultValue;
    return typeof defaultValue === "string"
      ? interpolate(defaultValue, params)
      : key;
  }
  return interpolate(str, params);
}
