import { sendApiRequest } from "./apiTauriBridge";
import type { ApiMethod, DiscoveredEndpoint, KeyValueParam } from "../types";

// Common route probe candidates for REST/Microservice APIs
const COMMON_ROUTE_PROBES: { path: string; method: ApiMethod; description: string }[] = [
  { path: "ping", method: "GET", description: "Health/Ping check" },
  { path: "health", method: "GET", description: "Service health probe" },
  { path: "status", method: "GET", description: "System / runtime status" },
  { path: "version", method: "GET", description: "API / Server version info" },
  { path: "info", method: "GET", description: "Service metadata" },
  { path: "me", method: "GET", description: "Authenticated user profile" },
  { path: "profile", method: "GET", description: "User profile details" },
  { path: "clients", method: "GET", description: "Clients / Customers collection" },
  { path: "clientes", method: "GET", description: "Colección de clientes" },
  { path: "users", method: "GET", description: "User accounts collection" },
  { path: "usuarios", method: "GET", description: "Colección de usuarios" },
  { path: "leads", method: "GET", description: "CRM Leads / Opportunities" },
  { path: "contacts", method: "GET", description: "Contacts address book" },
  { path: "tasks", method: "GET", description: "Tasks & To-do queue" },
  { path: "tareas", method: "GET", description: "Listado de tareas" },
  { path: "projects", method: "GET", description: "Project catalog" },
  { path: "items", method: "GET", description: "Inventory items" },
  { path: "products", method: "GET", description: "Products catalog" },
  { path: "posts", method: "GET", description: "Blog posts collection" },
  { path: "todos", method: "GET", description: "To-do list collection" },
  { path: "comments", method: "GET", description: "Comments collection" },
  { path: "quotes", method: "GET", description: "Quotes catalog" },
  { path: "test", method: "GET", description: "API test endpoint" },
  { path: "orders", method: "GET", description: "Orders collection" },
  { path: "stats", method: "GET", description: "Analytics & statistics" },
  { path: "auth", method: "GET", description: "Authentication status" },
  { path: "auth/check", method: "GET", description: "Session verification" },
  { path: "config", method: "GET", description: "Public configuration" },
  { path: "models", method: "GET", description: "AI Models catalog" },
  { path: "tags", method: "GET", description: "Local model tags" },
];

const KNOWN_SERVICE_FINGERPRINTS: {
  matcher: (url: string) => boolean;
  serviceName: string;
  endpoints: { path: string; method: ApiMethod; description: string; sampleBody?: string }[];
}[] = [
  {
    // Ollama Engine
    matcher: (url) => url.includes("11434") || url.includes("/api/tags") || url.includes("/api/generate"),
    serviceName: "Ollama Local LLM",
    endpoints: [
      { path: "/api/tags", method: "GET", description: "List local downloaded models" },
      { path: "/api/version", method: "GET", description: "Get Ollama server version" },
      { path: "/api/ps", method: "GET", description: "List currently active/loaded models in VRAM" },
      {
        path: "/api/generate",
        method: "POST",
        description: "Generate a text completion with a model",
        sampleBody: JSON.stringify({ model: "llama3.2", prompt: "Why is the sky blue?", stream: false }, null, 2),
      },
      {
        path: "/api/chat",
        method: "POST",
        description: "Generate a chat completion with messages array",
        sampleBody: JSON.stringify({
          model: "llama3.2",
          messages: [{ role: "user", content: "Hello!" }],
          stream: false,
        }, null, 2),
      },
      {
        path: "/api/embed",
        method: "POST",
        description: "Generate vector embeddings for input text",
        sampleBody: JSON.stringify({ model: "all-minilm", input: "Here is an article about text embeddings" }, null, 2),
      },
      {
        path: "/api/pull",
        method: "POST",
        description: "Pull/Download a model from the Ollama library",
        sampleBody: JSON.stringify({ model: "llama3.2:latest" }, null, 2),
      },
      {
        path: "/api/delete",
        method: "DELETE",
        description: "Delete a local model from disk",
        sampleBody: JSON.stringify({ model: "model-to-delete" }, null, 2),
      },
    ],
  },
  {
    // Docker Daemon REST API
    matcher: (url) => url.includes(":2375") || url.includes(":2376") || url.includes("/v1."),
    serviceName: "Docker Engine API",
    endpoints: [
      { path: "/_ping", method: "GET", description: "Ping Docker daemon" },
      { path: "/version", method: "GET", description: "Show Docker version details" },
      { path: "/info", method: "GET", description: "Get system-wide Docker info" },
      { path: "/containers/json?all=1", method: "GET", description: "List all containers" },
      { path: "/images/json", method: "GET", description: "List all container images" },
      { path: "/volumes", method: "GET", description: "List all Docker volumes" },
      { path: "/networks", method: "GET", description: "List all Docker networks" },
    ],
  },
  {
    // OpenAI / vLLM / LocalAI Compatible
    matcher: (url) => url.includes("/v1/chat") || url.includes("/v1/models") || url.includes("api.openai.com"),
    serviceName: "OpenAI / LocalAI Compatible Server",
    endpoints: [
      { path: "/v1/models", method: "GET", description: "List available LLM models" },
      {
        path: "/v1/chat/completions",
        method: "POST",
        description: "Standard chat completion endpoint",
        sampleBody: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello!" }],
        }, null, 2),
      },
      {
        path: "/v1/embeddings",
        method: "POST",
        description: "Generate text embeddings",
        sampleBody: JSON.stringify({ model: "text-embedding-3-small", input: "Sample text" }, null, 2),
      },
    ],
  },
  {
    // Stripe API
    matcher: (url) => url.includes("api.stripe.com") || url.includes("stripe"),
    serviceName: "Stripe API",
    endpoints: [
      { path: "/v1/customers", method: "GET", description: "List Stripe customers" },
      { path: "/v1/payment_intents", method: "GET", description: "List payment intents" },
      { path: "/v1/charges", method: "GET", description: "List credit card charges" },
      { path: "/v1/balance", method: "GET", description: "Retrieve account balance" },
      { path: "/v1/invoices", method: "GET", description: "List customer invoices" },
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
            description: ep.description,
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
          description: probe.description,
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
