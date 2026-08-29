import { t } from "@/modules/i18n";
import { sendApiRequest } from "./apiTauriBridge";
import type { ApiMethod, DiscoveredEndpoint, KeyValueParam } from "../types";

// Common route probe candidates for REST/Microservice APIs
const COMMON_ROUTE_PROBES: { path: string; method: ApiMethod }[] = [
  { path: "ping", method: "GET" }, { path: "health", method: "GET" }, { path: "status", method: "GET" },
  { path: "version", method: "GET" }, { path: "info", method: "GET" }, { path: "me", method: "GET" },
  { path: "profile", method: "GET" }, { path: "clients", method: "GET" }, { path: "clientes", method: "GET" },
  { path: "users", method: "GET" }, { path: "usuarios", method: "GET" }, { path: "leads", method: "GET" },
  { path: "contacts", method: "GET" }, { path: "tasks", method: "GET" }, { path: "tareas", method: "GET" },
  { path: "projects", method: "GET" }, { path: "items", method: "GET" }, { path: "products", method: "GET" },
  { path: "posts", method: "GET" }, { path: "todos", method: "GET" }, { path: "comments", method: "GET" },
  { path: "quotes", method: "GET" }, { path: "test", method: "GET" }, { path: "orders", method: "GET" },
  { path: "stats", method: "GET" }, { path: "auth", method: "GET" }, { path: "auth/check", method: "GET" },
  { path: "config", method: "GET" }, { path: "models", method: "GET" }, { path: "tags", method: "GET" },
];

const KNOWN_SERVICE_FINGERPRINTS: {
  matcher: (url: string) => boolean;
  serviceName: string;
  endpoints: { path: string; method: ApiMethod; sampleBody?: string }[];
}[] = [
  {
    // Ollama Engine
    matcher: (url) => url.includes("11434") || url.includes("/api/tags") || url.includes("/api/generate"),
    serviceName: "Ollama Local LLM",
    endpoints: [
      { path: "/api/tags", method: "GET" },
      { path: "/api/version", method: "GET" },
      { path: "/api/ps", method: "GET" },
      {
        path: "/api/generate",
        method: "POST",
        sampleBody: JSON.stringify({ model: "llama3.2", prompt: "Why is the sky blue?", stream: false }, null, 2),
      },
      {
        path: "/api/chat",
        method: "POST",
        sampleBody: JSON.stringify({
          model: "llama3.2",
          messages: [{ role: "user", content: "Hello!" }],
          stream: false,
        }, null, 2),
      },
      {
        path: "/api/embed",
        method: "POST",
        sampleBody: JSON.stringify({ model: "all-minilm", input: "Here is an article about text embeddings" }, null, 2),
      },
      {
        path: "/api/pull",
        method: "POST",
        sampleBody: JSON.stringify({ model: "llama3.2:latest" }, null, 2),
      },
      {
        path: "/api/delete",
        method: "DELETE",
        sampleBody: JSON.stringify({ model: "model-to-delete" }, null, 2),
      },
    ],
  },
  {
    // Docker Daemon REST API
    matcher: (url) => url.includes(":2375") || url.includes(":2376") || url.includes("/v1."),
    serviceName: "Docker Engine API",
    endpoints: [
      { path: "/_ping", method: "GET" },
      { path: "/version", method: "GET" },
      { path: "/info", method: "GET" },
      { path: "/containers/json?all=1", method: "GET" },
      { path: "/images/json", method: "GET" },
      { path: "/volumes", method: "GET" },
      { path: "/networks", method: "GET" },
    ],
  },
  {
    // OpenAI / vLLM / LocalAI Compatible
    matcher: (url) => url.includes("/v1/chat") || url.includes("/v1/models") || url.includes("api.openai.com"),
    serviceName: "OpenAI / LocalAI Compatible Server",
    endpoints: [
      { path: "/v1/models", method: "GET" },
      {
        path: "/v1/chat/completions",
        method: "POST",
        sampleBody: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello!" }],
        }, null, 2),
      },
      {
        path: "/v1/embeddings",
        method: "POST",
        sampleBody: JSON.stringify({ model: "text-embedding-3-small", input: "Sample text" }, null, 2),
      },
    ],
  },
  {
    // Stripe API
    matcher: (url) => url.includes("api.stripe.com") || url.includes("stripe"),
    serviceName: "Stripe API",
    endpoints: [
      { path: "/v1/customers", method: "GET" },
      { path: "/v1/payment_intents", method: "GET" },
      { path: "/v1/charges", method: "GET" },
      { path: "/v1/balance", method: "GET" },
      { path: "/v1/invoices", method: "GET" },
    ],
  },
];

export type DiscoveryResult = {
  baseUrl: string;
  detectedService?: string;
  openApiFound: boolean;
  endpoints: DiscoveredEndpoint[];
  durationMs: number;
};

/**
 * Normalizes baseUrl ensuring no trailing slashes.
 */
function cleanBaseUrl(url: string): string {
  let cleaned = url.trim();
  if (cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * Intelligently discovers all available routes behind a given base URL or API server.
 */
export async function discoverApiEndpoints(
  rawUrl: string,
  headers: KeyValueParam[] = [],
  apiKey?: { key: string; value: string; inHeader: boolean },
  bearerToken?: string,
): Promise<DiscoveryResult> {
  const startTime = performance.now();
  const baseUrl = cleanBaseUrl(rawUrl);
  const endpoints: DiscoveredEndpoint[] = [];
  const seenPaths = new Set<string>();

  let detectedService: string | undefined;
  let openApiFound = false;

  // 1. Check Service Fingerprints
  for (const fp of KNOWN_SERVICE_FINGERPRINTS) {
    if (fp.matcher(baseUrl)) {
      detectedService = fp.serviceName;
      for (const ep of fp.endpoints) {
        // Resolve full URL
        let epFullUrl = "";
        if (baseUrl.endsWith("/api") && ep.path.startsWith("/api/")) {
          epFullUrl = baseUrl + ep.path.replace(/^\/api/, "");
        } else if (baseUrl.endsWith("/v1") && ep.path.startsWith("/v1/")) {
          epFullUrl = baseUrl + ep.path.replace(/^\/v1/, "");
        } else {
          epFullUrl = `${baseUrl.replace(/\/$/, "")}${ep.path}`;
        }

        if (!seenPaths.has(ep.path)) {
          seenPaths.add(ep.path);
          endpoints.push({
            path: ep.path,
            fullUrl: epFullUrl,
            method: ep.method,
            description: t("apiClient.discovery.knownEndpoint", { path: ep.path }),
            sampleBody: ep.sampleBody,
            source: "fingerprint",
          });
        }
      }
    }
  }

  // 2. Try OpenAPI / Swagger discovery
  const openApiCandidates = [
    `${baseUrl}/openapi.json`,
    `${baseUrl}/swagger.json`,
    `${baseUrl}/api-docs`,
    `${baseUrl}/docs/json`,
    `${baseUrl}/v1/openapi.json`,
  ];

  for (const candidate of openApiCandidates) {
    try {
      const res = await sendApiRequest({
        id: "openapi-probe",
        name: "OpenAPI Spec Probe",
        url: candidate,
        method: "GET",
        headers,
        queryParams: [],
        bodyType: "none",
        bodyContent: "",
        authType: apiKey ? "apiKey" : bearerToken ? "bearer" : "none",
        apiKey,
        bearerToken,
        timeoutMs: 3000,
      });

      if (res.status === 200 && res.isJson && res.jsonValue) {
        const spec = res.jsonValue as Record<string, unknown>;
        if (spec.paths && typeof spec.paths === "object") {
          openApiFound = true;
          detectedService = detectedService || (spec.info && typeof spec.info === "object" ? (spec.info as Record<string, string>).title : "OpenAPI Service");

          for (const [pathKey, methods] of Object.entries(spec.paths as Record<string, Record<string, unknown>>)) {
            if (typeof methods === "object" && methods !== null) {
              for (const [methodKey, methodDetails] of Object.entries(methods)) {
                const upperMethod = methodKey.toUpperCase() as ApiMethod;
                if (["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(upperMethod)) {
                  const details = methodDetails as Record<string, unknown>;
                  const description = (details.summary as string) || (details.description as string) || "";
                  const fullUrl = `${baseUrl}${pathKey}`;

                  if (!seenPaths.has(`${upperMethod} ${pathKey}`)) {
                    seenPaths.add(`${upperMethod} ${pathKey}`);
                    endpoints.push({
                      path: pathKey,
                      fullUrl,
                      method: upperMethod,
                      description,
                      source: "openapi",
                    });
                  }
                }
              }
            }
          }
          break; // Found working spec
        }
      }
    } catch {
      // Continue to next probe
    }
  }

  // 3. Smart Heuristic Probing on common routes
  const probeTasks = COMMON_ROUTE_PROBES.map(async (probe) => {
    const probeUrl = `${baseUrl}/${probe.path}`;
    try {
      const res = await sendApiRequest({
        id: `probe-${probe.path}`,
        name: `Probe ${probe.path}`,
        url: probeUrl,
        method: probe.method,
        headers,
        queryParams: [],
        bodyType: "none",
        bodyContent: "",
        authType: apiKey ? "apiKey" : bearerToken ? "bearer" : "none",
        apiKey,
        bearerToken,
        timeoutMs: 4000,
      });

      // Status 200, 201, 204, 401 (auth exists), 403, 405 (method not allowed means route exists!)
      if (res.status !== 404 && res.status > 0) {
        return {
          path: `/${probe.path}`,
          fullUrl: probeUrl,
          method: probe.method,
          status: res.status,
          statusText: res.statusText,
          durationMs: res.timings.totalDurationMs,
          description: t("apiClient.discovery.probeEndpoint", { path: `/${probe.path}` }),
          requiresAuth: res.status === 401 || res.status === 403,
          source: "probe" as const,
        };
      }
    } catch {
      // Ignore network errors on negative probes
    }
    return null;
  });

  const probeResults = await Promise.allSettled(probeTasks);
  for (const r of probeResults) {
    if (r.status === "fulfilled" && r.value) {
      const ep = r.value;
      const key = `${ep.method} ${ep.path}`;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        endpoints.push(ep);
      } else {
        // Update existing fingerprint with live status & latency
        const existing = endpoints.find((e) => e.path === ep.path && e.method === ep.method);
        if (existing) {
          existing.status = ep.status;
          existing.statusText = ep.statusText;
          existing.durationMs = ep.durationMs;
          existing.requiresAuth = ep.requiresAuth;
        }
      }
    }
  }

  const durationMs = Math.round(performance.now() - startTime);

  return {
    baseUrl,
    detectedService,
    openApiFound,
    endpoints,
    durationMs,
  };
}
