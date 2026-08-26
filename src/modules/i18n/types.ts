export const SUPPORTED_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "pt", label: "Português" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "it", label: "Italiano" },
  { id: "zh", label: "简体中文" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "ru", label: "Русский" },
  { id: "hi", label: "हिन्दी" },
  { id: "ar", label: "العربية" },
] as const;

export type LanguageId = (typeof SUPPORTED_LANGUAGES)[number]["id"];

export function isLanguageId(value: unknown): value is LanguageId {
  return (
    typeof value === "string" &&
    SUPPORTED_LANGUAGES.some((lang) => lang.id === value)
  );
}

export type TranslationParams = Record<string, string | number>;
