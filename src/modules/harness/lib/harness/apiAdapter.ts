import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import { getCustomEndpointKey } from "@/modules/ai/lib/keyring";
import { parseCompatModelId, type CustomEndpoint } from "@/modules/ai/config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { syncCustomEndpointsToHarness } from "../models";
import { registerHarness, type HarnessAdapter } from "./registry";
import type {
  ApprovalDecision,
  SendTurnInput,
  SteerTurnInput,
} from "./types";
import { streamText, type LanguageModel, type ModelMessage } from "ai";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

const activeControllers = new Map<string, AbortController>();
const historyBySession = new Map<string, ModelMessage[]>();

async function resolveApiModel(
  modelId: string,
  endpoints: readonly CustomEndpoint[],
): Promise<LanguageModel> {
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
    const customEndpoints = usePreferencesStore.getState().customEndpoints ?? [];
    const model = await resolveApiModel(input.model, customEndpoints);

    const history = historyBySession.get(input.sessionId) ?? [];
    history.push({ role: "user", content: input.text });

    const result = streamText({
      model,
      messages: history,
      abortSignal: controller.signal,
    });

    let fullText = "";
    for await (const part of result.fullStream) {
      if (controller.signal.aborted) break;
      if (part.type === "text-delta") {
        fullText += part.text;
        input.onEvent({ type: "message.delta", text: part.text });
      } else if (part.type === "reasoning-delta") {
        input.onEvent({ type: "reasoning.delta", text: part.text });
      }
    }

    if (controller.signal.aborted) {
      input.onEvent({ type: "session.ended", code: 0 });
      return;
    }

    if (fullText) {
      history.push({ role: "assistant", content: fullText });
      historyBySession.set(input.sessionId, history);
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
}

export async function forgetApiSession(sessionId: string): Promise<void> {
  await cancelApiTurn(sessionId);
  historyBySession.delete(sessionId);
}

export function bindApiSession(
  _threadId: string,
  _providerSessionId: string,
  _cwd: string,
): void {
  // Stateless resume
}

export async function refreshApiCatalog(): Promise<void> {
  const endpoints = usePreferencesStore.getState().customEndpoints ?? [];
  syncCustomEndpointsToHarness(endpoints);
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
}
