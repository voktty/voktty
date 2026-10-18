import { createProxyFetch } from "./proxyFetch";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

export type FetchModelsOptions = {
  apiKey?: string | null;
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
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers["api-key"] = key;
  }

  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetchFn(endpoint, {
        method: "GET",
        headers,
        signal: options.signal,
      });

      if (res.status === 404 && endpoints.length > 1 && endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${errorText ? `: ${errorText.slice(0, 160)}` : ""}`);
      }

      const json = (await res.json()) as unknown;
      if (typeof json !== "object" || json === null) {
        throw new Error("Invalid response format from /models");
      }

      const data = "data" in json && Array.isArray(json.data) ? json.data : null;
      if (!data) {
        // Some endpoints return an array directly e.g. ["model-a", "model-b"]
        if (Array.isArray(json)) {
          const directIds = json
            .map((item) => (typeof item === "string" ? item : typeof item?.id === "string" ? item.id : null))
            .filter((id): id is string => Boolean(id));
          return Array.from(new Set(directIds)).sort((a, b) => a.localeCompare(b));
        }
        throw new Error("Missing 'data' array in models response");
      }

      const ids = data
        .map((item) => (typeof item?.id === "string" ? item.id : null))
        .filter((id): id is string => Boolean(id));

      return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (lastError) throw lastError;
  return [];
}
