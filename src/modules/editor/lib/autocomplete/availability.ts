import {
  providerNeedsKey,
  type AutocompleteProviderId,
} from "@/modules/ai/config";

export type AutocompleteProviderAccess = {
  provider: AutocompleteProviderId;
  apiKey: string | null;
  lmstudioBaseURL?: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
};

function hasValue(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function hasAutocompleteAccess(
  input: AutocompleteProviderAccess,
): boolean {
  if (providerNeedsKey(input.provider)) return hasValue(input.apiKey);

  switch (input.provider) {
    case "lmstudio":
      return hasValue(input.lmstudioBaseURL);
    case "mlx":
      return hasValue(input.mlxBaseURL);
    case "ollama":
      return hasValue(input.ollamaBaseURL);
    case "openai-compatible":
      return hasValue(input.openaiCompatibleBaseURL);
    default:
      return false;
  }
}
