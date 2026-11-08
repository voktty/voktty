import type { ApiProtocol } from "../config";
import { createProxyFetch } from "./proxyFetch";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

export type FetchModelsOptions = {
  apiKey?: string | null;
  protocol?: ApiProtocol;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
};

export function buildModelEndpoints(rawBaseURL: string): string[] {
  const trimmed = rawBaseURL.trim().replace(/\/+$/, "");
  if (!trimmed) return [];
  if (trimmed.endsWith("/models")) {
    return [trimmed];
  }
  if (trimmed.endsWith("/v1")) {
    return [`${trimmed}/models`];
  }
  // Try /models first; fall back to /v1/models if the root server does not mount it directly.
  return [`${trimmed}/models`, `${trimmed}/v1/models`];
}

function extractModelId(item: unknown): string | null {
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed ? trimmed.replace(/^models\//, "") : null;
  }
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    const rawId =
      typeof obj.id === "string"
        ? obj.id
        : typeof obj.name === "string"
          ? obj.name
          : typeof obj.model === "string"
            ? obj.model
            : null;
    if (rawId) {
      const trimmed = rawId.trim();
      return trimmed ? trimmed.replace(/^models\//, "") : null;
    }
  }
  return null;
}

export async function fetchCompatibleModels(
  baseURL: string,
  options: FetchModelsOptions = {},
): Promise<string[]> {
  const endpoints = buildModelEndpoints(baseURL);
  if (endpoints.length === 0) return [];

  const fetchFn = options.fetchFn ?? localProxyFetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const key = options.apiKey?.trim();
  const isAnthropic =
    options.protocol === "anthropic-messages" ||
    (key?.startsWith("sk-ant-") ?? false);

  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers["api-key"] = key;
    if (isAnthropic) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    }
  }

  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetchFn(endpoint, {
        method: "GET",
        headers,
        signal: options.signal,
      });

      if (
        res.status === 404 &&
        endpoints.length > 1 &&
        endpoint !== endpoints[endpoints.length - 1]
      ) {
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status}${errorText ? `: ${errorText.slice(0, 160)}` : ""}`,
        );
      }

      const json = (await res.json()) as unknown;
      if (typeof json !== "object" || json === null) {
        throw new Error("Invalid response format from /models");
      }

      // Check OpenAI standard { data: [...] }
      if ("data" in json && Array.isArray((json as { data: unknown }).data)) {
        const data = (json as { data: unknown[] }).data;
        const ids = data.map(extractModelId).filter((id): id is string => Boolean(id));
        return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
      }

      // Check Ollama / Google Gemini { models: [...] }
      if ("models" in json && Array.isArray((json as { models: unknown }).models)) {
        const modelsList = (json as { models: unknown[] }).models;
        const ids = modelsList
          .map(extractModelId)
          .filter((id): id is string => Boolean(id));
        return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
      }

      // Some endpoints return an array directly e.g. ["model-a", "model-b"] or [{ id: "model-a" }]
      if (Array.isArray(json)) {
        const directIds = json
          .map(extractModelId)
          .filter((id): id is string => Boolean(id));
        return Array.from(new Set(directIds)).sort((a, b) => a.localeCompare(b));
      }

      throw new Error("Missing 'data' or 'models' array in response");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (lastError) throw lastError;
  return [];
}
