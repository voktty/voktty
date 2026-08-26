import {
  endpointIdFromCompatModel,
  type ProviderId,
} from "@/modules/ai/config";
import type { Preferences } from "@/modules/settings/store";
import type { CompletionDeps } from "./provider";

export type AutocompleteSelection = Omit<
  CompletionDeps,
  "apiKey" | "capabilities"
> & {
  endpointId?: string;
};

type Snapshot = Pick<
  Preferences,
  | "autocompleteProvider"
  | "autocompleteModelId"
  | "lmstudioBaseURL"
  | "lmstudioModelId"
  | "mlxBaseURL"
  | "mlxModelId"
  | "ollamaBaseURL"
  | "ollamaModelId"
  | "openaiCompatibleBaseURL"
  | "openaiCompatibleModelId"
  | "openrouterModelId"
  | "customEndpoints"
>;

function localModelId(provider: ProviderId, snapshot: Snapshot): string | null {
  if (provider === "lmstudio") return snapshot.lmstudioModelId;
  if (provider === "mlx") return snapshot.mlxModelId;
  if (provider === "ollama") return snapshot.ollamaModelId;
  return null;
}

export function resolveAutocompleteSelection(
  snapshot: Snapshot,
): AutocompleteSelection {
  const provider = snapshot.autocompleteProvider;
  const endpointId =
    provider === "openai-compatible"
      ? endpointIdFromCompatModel(snapshot.autocompleteModelId)
      : "";
  const endpoint = endpointId
    ? snapshot.customEndpoints.find((item) => item.id === endpointId)
    : undefined;
  const local = localModelId(provider, snapshot);
  const modelId =
    local !== null
      ? local
      : provider === "openai-compatible"
        ? (endpoint?.modelId ?? snapshot.openaiCompatibleModelId)
        : provider === "openrouter" &&
            snapshot.autocompleteModelId === "openrouter-custom"
          ? snapshot.openrouterModelId
          : snapshot.autocompleteModelId;

  return {
    provider,
    modelId,
    lmstudioBaseURL: snapshot.lmstudioBaseURL,
    mlxBaseURL: snapshot.mlxBaseURL,
    ollamaBaseURL: snapshot.ollamaBaseURL,
    openaiCompatibleBaseURL:
      endpoint?.baseURL ?? snapshot.openaiCompatibleBaseURL,
    profileOverride: endpoint?.autocompleteProfile ?? "auto",
    ...(endpointId ? { endpointId } : {}),
  };
}
