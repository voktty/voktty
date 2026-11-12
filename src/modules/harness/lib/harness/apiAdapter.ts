import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import { getAllKeys, getCustomEndpointKey } from "@/modules/ai/lib/keyring";
import {
  getProvider,
  MODEL_CONTEXT_LIMITS,
  MODELS,
  parseCompatModelId,
  providerNeedsKey,
  type CustomEndpoint,
  type ProviderId,
} from "@/modules/ai/config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import {
  API_PROVIDER_MODEL_PREFIX,
  syncCustomEndpointsToHarness,
  syncKeyedProvidersToHarness,
} from "../models";
import { registerHarness, type HarnessAdapter } from "./registry";
import type {
  ApprovalDecision,
  SendTurnInput,
  SteerTurnInput,
} from "./types";
import type { LanguageModel, ModelMessage } from "ai";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

const activeControllers = new Map<string, AbortController>();
const historyBySession = new Map<string, ModelMessage[]>();
let apiToolsModule: typeof import("./apiTools") | undefined;
const MAX_HISTORY_CHARS = 1024 * 1024;

export function boundedApiHistory(messages: ModelMessage[]): ModelMessage[] {
  const sizes = messages.map((message) => JSON.stringify(message).length + 1);
  let total = sizes.reduce((sum, size) => sum + size, 1);
  let start = 0;
  for (let index = 1; index < messages.length; index++) {
    if (messages[index].role !== "user") continue;
    if (total <= MAX_HISTORY_CHARS) break;
    while (start < index) total -= sizes[start++];
  }
  return messages.slice(start);
}

async function resolveApiModel(
  modelId: string,
  endpoints: readonly CustomEndpoint[],
): Promise<LanguageModel> {
  if (modelId.startsWith(API_PROVIDER_MODEL_PREFIX)) {
    const raw = modelId.slice(API_PROVIDER_MODEL_PREFIX.length);
    const colonIndex = raw.indexOf(":");
    const provider = raw.slice(0, colonIndex) as ProviderId;
    const chatModelId = raw.slice(colonIndex + 1);
    const keys = await getAllKeys();
    const local = localProviderConfig();
    if (
      colonIndex <= 0 ||
      !availableProviderModels(keys, local).some(
        (model) => model.provider === provider && model.id === chatModelId,
      )
    ) {
      throw new Error(`API model is not configured: ${modelId}`);
    }
    const { buildConfiguredLanguageModel } = await import(
      "@/modules/ai/lib/agent"
    );
    return buildConfiguredLanguageModel(chatModelId, keys, local);
  }

  let endpointId = "";
  let subModelId = "";

  if (modelId.startsWith("api:")) {
    const raw = modelId.slice(4);
    const colonIndex = raw.indexOf(":");
    endpointId = colonIndex === -1 ? raw : raw.slice(0, colonIndex);
    subModelId = colonIndex === -1 ? "" : raw.slice(colonIndex + 1);
  } else if (modelId.startsWith("compat-")) {
    const parsed = parseCompatModelId(modelId);
    endpointId = parsed.endpointId;
    subModelId = parsed.subModelId ?? "";
  }

  const ep = endpoints.find((e) => e.id === endpointId);
  const activeModel = (subModelId || ep?.modelId || modelId).trim();

  if (ep) {
    const key = (await getCustomEndpointKey(ep.id)) ?? "";
    if (ep.protocol === "anthropic-messages") {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({
        baseURL: ep.baseURL,
        apiKey: key,
        headers: key
          ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
          : undefined,
      })(activeModel);
    }

    const { createOpenAICompatible } = await import(
      "@ai-sdk/openai-compatible"
    );
    return createOpenAICompatible({
      name: ep.name || "api-compatible",
      baseURL: ep.baseURL,
      apiKey: key || undefined,
      headers: key ? { "api-key": key } : undefined,
      fetch: localProxyFetch,
    })(activeModel);
  }

  // Fallback to generic OpenAI compatible if no endpoint matched
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    fetch: localProxyFetch,
  })(activeModel);
}

export async function sendApiTurn(input: SendTurnInput): Promise<void> {
  // Cancel previous running turn on the same session if any
  activeControllers.get(input.sessionId)?.abort();

  const controller = new AbortController();
  activeControllers.set(input.sessionId, controller);

  input.onEvent({ type: "session.started" });
  input.onAccepted?.();

  const turnId = `api-turn-${Date.now()}`;
  input.onEvent({ type: "turn.started", providerTurnId: turnId });

  try {
    if (input.networkAllowlist != null)
      throw new Error("API agents do not support the requested network sandbox.");
    const customEndpoints = usePreferencesStore.getState().customEndpoints ?? [];
    const model = await resolveApiModel(input.model, customEndpoints);

    if (controller.signal.aborted) {
      input.onEvent({ type: "session.ended", code: 0 });
      return;
    }
    const history: ModelMessage[] = [
      ...(historyBySession.get(input.sessionId) ?? []),
      { role: "user", content: input.text },
    ];

    const { runApiAgentLoop } = await import("./apiAgentLoop");
    const apiTools = await import("./apiTools");
    apiToolsModule = apiTools;
    const { buildStableSystem } = await import("@/modules/ai/lib/agent");
    if (controller.signal.aborted) {
      input.onEvent({ type: "session.ended", code: 0 });
      return;
    }
    const context = apiTools.apiToolContext(input.sessionId, input.cwd, input.model);
    const tools = context ? apiTools.buildApiTools(context) : undefined;
    const { retireFileToolRun } = await import("@/modules/ai/lib/fileToolApprovals");
    let response: ModelMessage[];
    try {
      response = await runApiAgentLoop({
        model,
        messages: history,
        tools,
        system: buildStableSystem(input.model, null, undefined, null),
        signal: controller.signal,
        onEvent: input.onEvent,
      });
    } finally {
      if (tools) retireFileToolRun(tools);
    }

    if (controller.signal.aborted) {
      input.onEvent({ type: "session.ended", code: 0 });
      return;
    }

    if (response.length && activeControllers.get(input.sessionId) === controller) {
      historyBySession.set(input.sessionId, boundedApiHistory([...history, ...response]));
    }

    input.onEvent({ type: "message.completed" });
    input.onEvent({ type: "session.ended", code: 0 });
  } catch (err) {
    if (controller.signal.aborted) {
      input.onEvent({ type: "session.ended", code: 0 });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    input.onEvent({ type: "session.error", message });
    input.onEvent({ type: "session.ended", code: 1 });
    throw err;
  } finally {
    if (activeControllers.get(input.sessionId) === controller) {
      activeControllers.delete(input.sessionId);
    }
  }
}

export async function cancelApiTurn(sessionId: string): Promise<void> {
  const controller = activeControllers.get(sessionId);
  if (controller) {
    controller.abort();
    activeControllers.delete(sessionId);
  }
}

export async function steerApiTurn(input: SteerTurnInput): Promise<void> {
  // Steer turn by sending the message in sequence
  return sendApiTurn({
    ...input,
    runtimeMode: "full-access",
    onEvent: () => undefined,
  });
}

export function respondApiApproval(
  _sessionId: string,
  _requestId: number,
  _decision: ApprovalDecision,
): void {
  // No-op for direct API models
}

export async function stopApiSession(sessionId: string): Promise<void> {
  await cancelApiTurn(sessionId);
  await apiToolsModule?.forgetApiTools(sessionId);
}

export async function forgetApiSession(sessionId: string): Promise<void> {
  await stopApiSession(sessionId);
  historyBySession.delete(sessionId);
}

export function bindApiSession(
  _threadId: string,
  _providerSessionId: string,
  _cwd: string,
): void {
  // Stateless resume
}

function localProviderConfig() {
  const prefs = usePreferencesStore.getState();
  return {
    lmstudioBaseURL: prefs.lmstudioBaseURL,
    lmstudioModelId: prefs.lmstudioModelId,
    mlxBaseURL: prefs.mlxBaseURL,
    mlxModelId: prefs.mlxModelId,
    ollamaBaseURL: prefs.ollamaBaseURL,
    ollamaModelId: prefs.ollamaModelId,
    openaiCompatibleBaseURL: prefs.openaiCompatibleBaseURL,
    openaiCompatibleModelId: prefs.openaiCompatibleModelId,
    openrouterModelId: prefs.openrouterModelId,
    customEndpoints: prefs.customEndpoints,
  };
}

type LocalConfig = ReturnType<typeof localProviderConfig>;

const filled = (value: string | undefined) => !!value?.trim();

/**
 * Every chat model a configured provider can serve without the OAuth agents,
 * which already have their own tabs: cloud providers with a saved key, plus
 * OpenRouter, LM Studio, MLX, Ollama and the OpenAI-compatible slot once
 * their model id (and base URL) is set. Custom and third-party endpoints are
 * listed separately from the endpoint list.
 */
function availableProviderModels(
  keys: Awaited<ReturnType<typeof getAllKeys>>,
  local: LocalConfig,
) {
  // A third-party connection also saves the provider key; its endpoint
  // already lists the models, so the built-in entries would be duplicates.
  const viaEndpoint = new Set(
    (local.customEndpoints ?? []).flatMap((endpoint) =>
      endpoint.providerType ? [endpoint.providerType] : [],
    ),
  );
  return MODELS.filter((model) => {
    const provider: ProviderId = model.provider;
    if (provider === "harness" || viaEndpoint.has(provider)) return false;
    if (providerNeedsKey(provider) && !keys[provider]) return false;
    switch (model.id) {
      case "openrouter-custom":
        return filled(local.openrouterModelId);
      case "openai-compatible-custom":
        return (
          filled(local.openaiCompatibleBaseURL) &&
          filled(local.openaiCompatibleModelId)
        );
      case "lmstudio-local":
        return filled(local.lmstudioModelId);
      case "mlx-local":
        return filled(local.mlxModelId);
      case "ollama-local":
        return filled(local.ollamaModelId);
      default:
        return providerNeedsKey(provider);
    }
  });
}

function providerModelLabel(model: (typeof MODELS)[number], local: LocalConfig) {
  const configured: Partial<Record<string, string>> = {
    "openrouter-custom": local.openrouterModelId,
    "openai-compatible-custom": local.openaiCompatibleModelId,
    "lmstudio-local": local.lmstudioModelId,
    "mlx-local": local.mlxModelId,
    "ollama-local": local.ollamaModelId,
  };
  const id = configured[model.id]?.trim();
  return id ? `${model.label}: ${id}` : model.label;
}

export async function refreshApiCatalog(): Promise<void> {
  const endpoints = usePreferencesStore.getState().customEndpoints ?? [];
  syncCustomEndpointsToHarness(endpoints);
  const keys = await getAllKeys().catch(() => null);
  if (!keys) return;
  const local = localProviderConfig();
  syncKeyedProvidersToHarness(
    availableProviderModels(keys, local).map((model) => ({
      id: model.id,
      provider: model.provider,
      providerName: getProvider(model.provider).label,
      label: providerModelLabel(model, local),
      contextWindow: MODEL_CONTEXT_LIMITS[model.id],
    })),
  );
}

export const apiAdapter: HarnessAdapter = {
  id: "api",
  live: true,
  canSteer: false,
  sendTurn: sendApiTurn,
  steerTurn: steerApiTurn,
  cancelTurn: cancelApiTurn,
  respondApproval: respondApiApproval,
  stopSession: stopApiSession,
  forgetSession: forgetApiSession,
  bindSession: bindApiSession,
  refreshCatalog: refreshApiCatalog,
};

let registered = false;

export function ensureApiRegistered(): void {
  if (registered) return;
  registerHarness(apiAdapter);
  registered = true;
  // A key saved or removed in Settings changes which API models exist.
  void onKeysChanged(() => void refreshApiCatalog()).catch(() => undefined);
  usePreferencesStore.subscribe((state, previous) => {
    if (
      state.customEndpoints !== previous.customEndpoints ||
      state.lmstudioModelId !== previous.lmstudioModelId ||
      state.mlxModelId !== previous.mlxModelId ||
      state.ollamaModelId !== previous.ollamaModelId ||
      state.openaiCompatibleBaseURL !== previous.openaiCompatibleBaseURL ||
      state.openaiCompatibleModelId !== previous.openaiCompatibleModelId ||
      state.openrouterModelId !== previous.openrouterModelId
    )
      void refreshApiCatalog();
  });
  void refreshApiCatalog();
}
