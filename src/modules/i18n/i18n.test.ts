import { describe, expect, it } from "vitest";
import { interpolate } from "./interpolate";
import { translate } from "./resolve";
import { isLanguageId, SUPPORTED_LANGUAGES } from "./types";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { pt } from "./locales/pt";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { it as itLocale } from "./locales/it";
import { zh } from "./locales/zh";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { ru } from "./locales/ru";
import { hi } from "./locales/hi";
import { ar } from "./locales/ar";

function getAllKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  let keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      keys = keys.concat(getAllKeys(val as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

function getAllMessages(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(
        messages,
        getAllMessages(value as Record<string, unknown>, fullKey),
      );
    } else if (typeof value === "string") {
      messages[fullKey] = value;
    }
  }
  return messages;
}

function getInterpolationVariables(message: string): string[] {
  const withoutPluralBranches = message.replace(
    /(?:=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\}/g,
    "",
  );
  return [...withoutPluralBranches.matchAll(/\{([A-Za-z][\w]*)/g)]
    .map((match) => match[1])
    .filter((variable): variable is string => Boolean(variable))
    .filter(
      (variable, index, variables) => variables.indexOf(variable) === index,
    )
    .sort();
}

describe("i18n module", () => {
  it("interpolates parameters accurately", () => {
    expect(interpolate("Hello, {name}!", { name: "Voktty" })).toBe(
      "Hello, Voktty!",
    );
    expect(interpolate("Count: {count}", { count: 5 })).toBe("Count: 5");
    expect(interpolate("No params")).toBe("No params");
  });

  it("supports ICU-style plural blocks", () => {
    expect(translate("en", "ai.tools.labels.hitsCount", { count: 1 })).toBe(
      "1 hit",
    );
    expect(translate("en", "ai.tools.labels.hitsCount", { count: 4 })).toBe(
      "4 hits",
    );
    expect(translate("en", "gitHistory.filesChangedCount", { count: 2 })).toBe(
      "2 files changed",
    );
  });

  it("uses defaultValue when a translation key is missing", () => {
    expect(
      translate("es", "missing.translation", {
        defaultValue: "Fallback for {name}",
        name: "Voktty",
      }),
    ).toBe("Fallback for Voktty");
  });

  it("translates known keys in English and Spanish", () => {
    expect(translate("en", "common.save")).toBe("Save");
    expect(translate("es", "common.save")).toBe("Guardar");
    expect(translate("es", "feedback.uploadStarting", { fileName: "app.ts", dir: "/tmp" })).toBe(
      "Subiendo app.ts a /tmp...",
    );
    expect(translate("en", "tooltips.livePreview")).toBe("Live Preview");
    expect(translate("es", "settings.general.title")).toBe("General");
    expect(translate("es", "statusbar.spacesCount", { count: 3 })).toBe(
      "Espacios: 3",
    );
    expect(translate("hi", "common.save")).toBe("सहेजें");
    expect(translate("ar", "common.save")).toBe("حفظ");
  });

  it("translates git diff preview labels", () => {
    expect(translate("en", "git.diffBinaryFallback")).toBe(
      "Binary / patch fallback",
    );
    expect(translate("es", "git.diffLargeFile")).toBe(
      "Archivo grande / vista patch",
    );
    expect(translate("fr", "git.diffUnavailable")).toBe(
      "Aperçu du diff indisponible pour ce fichier.",
    );
  });

  it("maintains dictionary parity across every locale", () => {
    const enKeys = getAllKeys(en);
    const locales: Record<string, Record<string, unknown>> = {
      es,
      pt,
      fr,
      de,
      it: itLocale,
      zh,
      ja,
      ko,
      ru,
      hi,
      ar,
    };
    for (const locale of Object.values(locales)) {
      expect(getAllKeys(locale)).toEqual(enKeys);
    }
  });

  it("preserves interpolation variables in the canonical Spanish locale", () => {
    const englishMessages = getAllMessages(en);
    const locales: Record<string, Record<string, unknown>> = {
      es,
    };

    for (const [language, locale] of Object.entries(locales)) {
      const messages = getAllMessages(locale);
      for (const [key, englishMessage] of Object.entries(englishMessages)) {
        expect(
          getInterpolationVariables(messages[key] ?? ""),
          `${language}:${key}`,
        ).toEqual(getInterpolationVariables(englishMessage));
      }
    }
  });

  it("returns raw key if not found in any locale", () => {
    expect(translate("es", "nonexistent.key.path")).toBe(
      "nonexistent.key.path",
    );
  });

  it("validates language ids", () => {
    expect(isLanguageId("en")).toBe(true);
    expect(isLanguageId("es")).toBe(true);
    expect(isLanguageId("pt")).toBe(true);
    expect(isLanguageId("fr")).toBe(true);
    expect(isLanguageId("de")).toBe(true);
    expect(isLanguageId("it")).toBe(true);
    expect(isLanguageId("zh")).toBe(true);
    expect(isLanguageId("ja")).toBe(true);
    expect(isLanguageId("ko")).toBe(true);
    expect(isLanguageId("ru")).toBe(true);
    expect(isLanguageId("hi")).toBe(true);
    expect(isLanguageId("ar")).toBe(true);
    expect(isLanguageId("xx")).toBe(false);
    expect(SUPPORTED_LANGUAGES.map((l) => l.id)).toEqual([
      "en",
      "es",
      "pt",
      "fr",
      "de",
      "it",
      "zh",
      "ja",
      "ko",
      "ru",
      "hi",
      "ar",
    ]);
  });
});
