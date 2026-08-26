import { type CustomEndpoint, resolveModel } from "../config";
import { buildConfiguredLanguageModel } from "./agent";
import type { CustomEndpointKeys, ProviderKeys } from "./keyring";

export type AiHealthCheckConfig = {
  modelId: string;
  keys: ProviderKeys;
  customEndpointKeys: CustomEndpointKeys;
  lmstudioBaseURL: string;
  lmstudioModelId: string;
  mlxBaseURL: string;
  mlxModelId: string;
  ollamaBaseURL: string;
  ollamaModelId: string;
  openaiCompatibleBaseURL: string;
  openaiCompatibleModelId: string;
  openrouterModelId: string;
  customEndpoints: readonly CustomEndpoint[];
};

export async function runAiHealthCheck(
  config: AiHealthCheckConfig,
  abortSignal?: AbortSignal,
): Promise<{ latencyMs: number }> {
  const startedAt = performance.now();
  const model = await buildConfiguredLanguageModel(
    config.modelId,
    config.keys,
    {
      lmstudioBaseURL: config.lmstudioBaseURL,
      lmstudioModelId: config.lmstudioModelId,
      mlxBaseURL: config.mlxBaseURL,
      mlxModelId: config.mlxModelId,
      ollamaBaseURL: config.ollamaBaseURL,
      ollamaModelId: config.ollamaModelId,
      openaiCompatibleBaseURL: config.openaiCompatibleBaseURL,
      openaiCompatibleModelId: config.openaiCompatibleModelId,
      openrouterModelId: config.openrouterModelId,
      customEndpoints: config.customEndpoints,
      customEndpointKeys: config.customEndpointKeys,
    },
  );
  const provider = resolveModel(
    config.modelId,
    config.customEndpoints,
  ).provider;
  const { generateText } = await import("ai");
  const result = await generateText({
    model,
    prompt: "Reply with OK.",
    maxOutputTokens: 8,
    temperature: 0,
    abortSignal,
    ...(provider === "deepseek"
      ? {
          providerOptions: {
            deepseek: { thinking: { type: "disabled" } },
          },
        }
      : {}),
  });
  if (!result.text.trim())
    throw new Error("The model returned an empty response");
  return { latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
}
