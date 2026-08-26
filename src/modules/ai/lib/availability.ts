import type { Preferences } from "@/modules/settings/store";

export type AiAvailabilityPreferences = Pick<
  Preferences,
  "aiEnabled" | "aiConfigRevision" | "aiHealthRevision" | "aiHealthCheckedAt"
>;

export function hasCurrentAiHealth(
  preferences: AiAvailabilityPreferences,
): boolean {
  return (
    preferences.aiHealthCheckedAt !== null &&
    preferences.aiHealthRevision !== null &&
    preferences.aiHealthRevision === preferences.aiConfigRevision
  );
}

export function isAiAvailable(preferences: AiAvailabilityPreferences): boolean {
  return preferences.aiEnabled && hasCurrentAiHealth(preferences);
}
