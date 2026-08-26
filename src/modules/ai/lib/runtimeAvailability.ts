import { usePreferencesStore } from "@/modules/settings/preferences";
import { t } from "@/modules/i18n";
import { isAiAvailable } from "./availability";

export function isAiRuntimeAvailable(): boolean {
  return isAiAvailable(usePreferencesStore.getState());
}

export function requireAiRuntime(): void {
  if (!isAiRuntimeAvailable()) {
    throw new Error(t("settings.models.aiHealthRequired"));
  }
}

export function useAiAvailable(): boolean {
  return usePreferencesStore(isAiAvailable);
}
