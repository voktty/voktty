import { interpolate } from "./interpolate";
import { en } from "./locales/en";
import { isLanguageId, type LanguageId, type TranslationParams } from "./types";

type Dictionary = Record<string, unknown>;

const loaders: Record<LanguageId, () => Promise<Dictionary>> = {
  en: () => Promise.resolve(en),
  es: () => import("./locales/es").then((module) => module.es),
  pt: () => import("./locales/pt").then((module) => module.pt),
  fr: () => import("./locales/fr").then((module) => module.fr),
  de: () => import("./locales/de").then((module) => module.de),
  it: () => import("./locales/it").then((module) => module.it),
  zh: () => import("./locales/zh").then((module) => module.zh),
  ja: () => import("./locales/ja").then((module) => module.ja),
  ko: () => import("./locales/ko").then((module) => module.ko),
  ru: () => import("./locales/ru").then((module) => module.ru),
  hi: () => import("./locales/hi").then((module) => module.hi),
  ar: () => import("./locales/ar").then((module) => module.ar),
};

const dictionaries = new Map<LanguageId, Dictionary>([["en", en]]);
const pending = new Map<LanguageId, Promise<Dictionary>>();

function getNestedValue(obj: Dictionary, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      !(part in (current as Dictionary))
    ) {
      return undefined;
    }
    current = (current as Dictionary)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function normalizedLanguage(language: LanguageId | string): LanguageId {
  return isLanguageId(language) ? language : "en";
}

function loadDictionary(language: LanguageId): Promise<Dictionary> {
  const cached = dictionaries.get(language);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(language);
  if (inFlight) return inFlight;
  const loading = loaders[language]()
    .then((dictionary) => {
      dictionaries.set(language, dictionary);
      return dictionary;
    })
    .finally(() => pending.delete(language));
  pending.set(language, loading);
  return loading;
}

export async function loadLocale(language: LanguageId | string): Promise<void> {
  const target = normalizedLanguage(language);
  const english = loadDictionary("en");
  if (target === "en") {
    await english;
    return;
  }
  await Promise.all([
    english,
    loadDictionary(target).catch(() => dictionaries.get("en") ?? english),
  ]);
}

export function translate(
  lang: LanguageId,
  key: string,
  params?: TranslationParams,
): string {
  const target = dictionaries.get(normalizedLanguage(lang));
  const english = dictionaries.get("en");
  let str = target ? getNestedValue(target, key) : undefined;
  if (str === undefined && english) str = getNestedValue(english, key);
  if (str === undefined) {
    const defaultValue = params?.defaultValue;
    return typeof defaultValue === "string"
      ? interpolate(defaultValue, params)
      : key;
  }
  return interpolate(str, params);
}
