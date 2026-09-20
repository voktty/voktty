import type { Preferences } from "@/modules/settings/store";
import type { CustomEndpoint, ProviderId } from "../config";
import type { ProviderKeys } from "./keyring";

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

export type ProviderUsabilityPreferences = {
  harnessProviderEnabled?: boolean;
  lmstudioModelId?: string;
  mlxModelId?: string;
  ollamaModelId?: string;
  openrouterModelId?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  customEndpoints?: readonly CustomEndpoint[];
};

/**
 * Whether a provider can actually serve a model right now.
 *
 * A key is the wrong question for several of them: local servers need a model
 * id, custom endpoints need a base URL, and local agent providers authenticate
 * through their own CLI's OAuth session and never hold a key at all. A picker
 * that fell through to the key check hid every local agent model while
 * Settings showed one selected and verified.
 */
export function isProviderUsable(
  id: ProviderId,
  keys: ProviderKeys,
  preferences: ProviderUsabilityPreferences,
): boolean {
  switch (id) {
    case "harness":
      return preferences.harnessProviderEnabled === true;
    case "openrouter":
      return !!keys[id] && !!preferences.openrouterModelId?.trim();
    case "ollama":
      return !!preferences.ollamaModelId?.trim();
    case "lmstudio":
      return !!preferences.lmstudioModelId?.trim();
    case "mlx":
      return !!preferences.mlxModelId?.trim();
    case "openai-compatible":
      return (
        (preferences.customEndpoints?.length ?? 0) > 0 ||
        (!!preferences.openaiCompatibleBaseURL?.trim() &&
          !!preferences.openaiCompatibleModelId?.trim())
      );
    default:
      return !!keys[id];
  }
}
