import { usePreferencesStore } from "@/modules/settings/preferences";
import { setLanguage as persistLanguage } from "@/modules/settings/store";
import { translate } from "./resolve";
import type { LanguageId, TranslationParams } from "./types";

export * from "./types";
export { translate } from "./resolve";

export function useTranslation() {
  const language = usePreferencesStore((s) => s.language ?? "en");
  const t = (key: string, params?: TranslationParams) =>
    translate(language, key, params);

  return {
    t,
    language,
    setLanguage: persistLanguage,
  };
}

export function t(
  key: string,
  params?: TranslationParams,
  langOverride?: LanguageId,
): string {
  const lang =
    langOverride ??
    (usePreferencesStore.getState().language as LanguageId | undefined) ??
    "en";
  return translate(lang, key, params);
}
