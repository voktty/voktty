import type { AutocompleteProviderId } from "@/modules/ai/config";
import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";

export type CompletionReasoningLevel = "off" | "on" | "low" | "medium" | "high";

export type CompletionRuntimeCapabilities = {
  source: "lmstudio" | "ollama";
  reasoning: {
    supported: boolean;
    allowed: CompletionReasoningLevel[];
    default?: CompletionReasoningLevel;
  };
};

type CapabilityRequest = {
  provider: AutocompleteProviderId;
  modelId: string;
  lmstudioBaseURL: string;
  ollamaBaseURL?: string;
};

const localFetch = createProxyFetch({ allowPrivateNetwork: true });
const CACHE_TTL_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const cache = new Map<
  string,
  { expiresAt: number; value: CompletionRuntimeCapabilities | null }
>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reasoningLevel(value: unknown): CompletionReasoningLevel | null {
  return value === "off" ||
    value === "on" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
    ? value
    : null;
}

export function runtimeApiRoot(baseURL: string): string {
  const url = new URL(baseURL);
  url.pathname = url.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function parseLmStudioCapabilities(
  value: unknown,
  modelId: string,
): CompletionRuntimeCapabilities | null {
  const root = record(value);
  const models = Array.isArray(root?.models) ? root.models : [];
  const model = models
    .map(record)
    .find((item) => item?.key === modelId || item?.id === modelId);
  const capabilities = record(model?.capabilities);
  const reasoning = record(capabilities?.reasoning);
  if (!reasoning) return null;
  const allowed = Array.isArray(reasoning.allowed_options)
    ? reasoning.allowed_options
        .map(reasoningLevel)
        .filter((item): item is CompletionReasoningLevel => item !== null)
        .slice(0, 5)
    : [];
  const defaultLevel = reasoningLevel(reasoning.default);
  return {
    source: "lmstudio",
    reasoning: {
      supported: true,
      allowed,
      ...(defaultLevel ? { default: defaultLevel } : {}),
    },
  };
}

export function parseOllamaCapabilities(
  value: unknown,
  modelId: string,
): CompletionRuntimeCapabilities {
  const root = record(value);
  const capabilities = Array.isArray(root?.capabilities)
    ? root.capabilities.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const supported = capabilities.includes("thinking");
  const gptOss = /gpt[-_:]?oss/i.test(modelId);
  return {
    source: "ollama",
    reasoning: {
      supported,
      allowed: supported
        ? gptOss
          ? ["low", "medium", "high"]
          : ["off", "on"]
        : [],
      ...(supported ? { default: gptOss ? "medium" : "on" } : {}),
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok)
    throw new Error(`Capability request failed (${response.status}).`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error("Capability response exceeded the size limit.");
  }
  return JSON.parse(text) as unknown;
}

function cacheKey(input: CapabilityRequest): string {
  const base =
    input.provider === "ollama" ? input.ollamaBaseURL : input.lmstudioBaseURL;
  return `${input.provider}:${base ?? ""}:${input.modelId}`;
}

export function getCachedCompletionCapabilities(
  input: CapabilityRequest,
): CompletionRuntimeCapabilities | null | undefined {
  const hit = cache.get(cacheKey(input));
  if (!hit || hit.expiresAt <= Date.now()) return undefined;
  return hit.value;
}

export async function detectCompletionCapabilities(
  input: CapabilityRequest,
  signal: AbortSignal,
): Promise<CompletionRuntimeCapabilities | null> {
  const key = cacheKey(input);
  const cached = getCachedCompletionCapabilities(input);
  if (cached !== undefined) return cached;

  let value: CompletionRuntimeCapabilities | null = null;
  if (input.provider === "lmstudio") {
    const root = runtimeApiRoot(input.lmstudioBaseURL);
    const json = await readJson(
      await localFetch(`${root}/api/v1/models`, { signal }),
    );
    value = parseLmStudioCapabilities(json, input.modelId);
  } else if (input.provider === "ollama") {
    const root = runtimeApiRoot(
      input.ollamaBaseURL ?? "http://localhost:11434/v1",
    );
    const json = await readJson(
      await localFetch(`${root}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: input.modelId, verbose: false }),
        signal,
      }),
    );
    value = parseOllamaCapabilities(json, input.modelId);
  }

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
