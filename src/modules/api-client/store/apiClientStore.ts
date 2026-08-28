import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ApiClientTabMode,
  ApiCollection,
  ApiEnvironment,
  ApiFolder,
  ApiMethod,
  ApiRequest,
  ApiResponse,
  ApiScenario,
  ApiScenarioResult,
  ApiWebhookDispatch,
  ApiWebhookResult,
  DiscoveredEndpoint,
  KeyValueParam,
} from "../types";
import {
  cancelApiRequest,
  dispatchMockWebhook,
  runApiScenario,
  sendApiRequest,
} from "../lib/apiTauriBridge";
import { WEBHOOK_PRESETS, type WebhookPreset } from "../lib/presets";
import { discoverApiEndpoints, type DiscoveryResult } from "../lib/apiDiscovery";
import { parsePostmanCollection } from "../lib/postmanParser";

export type ApiClientStore = {
  activeTab: ApiClientTabMode;
  activeRequest: ApiRequest;
  activeResponse: ApiResponse | null;
  isLoading: boolean;
  error: string | null;

  // Sidebar and UI state
  sidebarCollapsed: boolean;
  variablesDrawerOpen: boolean;

  // Collections & Workspace Explorer
  collections: ApiCollection[];
  activeCollectionId: string;
  environments: ApiEnvironment[];
  activeEnvironmentId: string;

  // History
  history: { request: ApiRequest; response?: ApiResponse; timestamp: number }[];

  // Discovery / API Browser State
  discoveryUrl: string;
  isDiscovering: boolean;
  discoveryResult: DiscoveryResult | null;

  // Sandbox Webhook State
  webhookConfig: ApiWebhookDispatch;
  webhookResult: ApiWebhookResult | null;
  isDispatchingWebhook: boolean;

  // Scenario Runner State
  activeScenario: ApiScenario | null;
  scenarioResult: ApiScenarioResult | null;
  isRunningScenario: boolean;

  // UI Actions
  setActiveTab: (tab: ApiClientTabMode) => void;
  toggleSidebar: () => void;
  toggleVariablesDrawer: () => void;

  // Collection Actions
  setActiveCollection: (id: string) => void;
  createCollection: (name: string, description?: string) => void;
  deleteCollection: (id: string) => void;
  createFolder: (collectionId: string, name: string) => void;
  toggleFolder: (collectionId: string, folderId: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
  createRequest: (collectionId?: string, folderId?: string, req?: Partial<ApiRequest>) => void;
  selectRequest: (req: ApiRequest) => void;
  deleteRequest: (requestId: string) => void;
  renameRequest: (requestId: string, name: string) => void;

  // Environment Actions
  setEnvironment: (id: string) => void;
  createEnvironment: (name: string, color?: ApiEnvironment["color"]) => void;
  updateEnvironmentVariable: (envId: string, key: string, value: string) => void;
  deleteEnvironmentVariable: (envId: string, key: string) => void;

  // Request Builder Actions
  setUrl: (url: string) => void;
  setMethod: (method: ApiMethod) => void;
  addHeader: () => void;
  updateHeader: (index: number, patch: Partial<KeyValueParam>) => void;
  removeHeader: (index: number) => void;
  addQueryParam: () => void;
  updateQueryParam: (index: number, patch: Partial<KeyValueParam>) => void;
  removeQueryParam: (index: number) => void;
  setBodyType: (type: ApiRequest["bodyType"]) => void;
  setBodyContent: (content: string) => void;
  setAuthType: (type: ApiRequest["authType"]) => void;
  setBearerToken: (token: string) => void;
  setApiKey: (key: string, value: string, inHeader: boolean) => void;
  setBasicAuth: (username: string, password: string) => void;
  setOAuth2: (token: string, tokenType?: string) => void;
  setAwsSigV4: (config: ApiRequest["awsSigV4"]) => void;
  setDigestAuth: (username: string, password: string) => void;
  setRequestVariables: (variables: Record<string, string>) => void;

  sendRequest: () => Promise<ApiResponse | null>;
  cancelRequest: () => Promise<void>;
  loadFromHistory: (index: number) => void;
  clearHistory: () => void;
  importPostman: (jsonContent: string) => { count: number; name: string };

  // Discovery actions
  setDiscoveryUrl: (url: string) => void;
  runDiscovery: (targetUrl?: string) => Promise<DiscoveryResult | null>;
  loadEndpointToEditor: (endpoint: DiscoveredEndpoint) => void;

  // Webhook sandbox actions
  setWebhookTargetUrl: (url: string) => void;
  setWebhookService: (service: string) => void;
  setWebhookEventType: (type: string) => void;
  setWebhookPayload: (payload: Record<string, unknown>) => void;
  setWebhookSecret: (secret: string) => void;
  setWebhookDuplicateCount: (count: number) => void;
  applyWebhookPreset: (preset: WebhookPreset) => void;
  triggerWebhookDispatch: () => Promise<ApiWebhookResult | null>;

  // Scenario actions
  executeScenario: (scenario: ApiScenario) => Promise<ApiScenarioResult | null>;
};

const DEFAULT_POKEMON_REQUEST: ApiRequest = {
  id: "req-pokemon-paginated",
  name: "List Pokémon (paginated)",
  url: "{{ GRAPHQL_URL }}",
  method: "POST",
  headers: [
    { key: "Content-Type", value: "application/json", enabled: true },
    { key: "User-Agent", value: "Voktty-ApiClient/1.0", enabled: true },
  ],
  queryParams: [],
  bodyType: "graphql",
  bodyContent: `query ListPokemon($limit: Int!, $offset: Int!, $type: String) {
  pokemons(limit: $limit, offset: $offset, type: $type) {
    count
    results {
      id
      name
      types
    }
  }
}`,
  authType: "none",
  variables: {
    limit: "6",
    offset: "0",
    type: "water",
  },
};

const DEFAULT_COLLECTIONS: ApiCollection[] = [
  {
    id: "col-pokemon",
    name: "Pokémon API",
    description: "Pokemon REST, SSE & GraphQL API catalog with environments",
    requests: [],
    folders: [
      {
        id: "f-rest",
        name: "REST",
        isExpanded: true,
        requests: [
          {
            id: "req-rest-list",
            name: "List Pokemon (paginated)",
            url: "{{ BASE_URL }}/pokemon?limit=10&offset=0",
            method: "GET",
            headers: [{ key: "Accept", value: "application/json", enabled: true }],
            queryParams: [
              { key: "limit", value: "10", enabled: true },
              { key: "offset", value: "0", enabled: true },
            ],
            bodyType: "none",
            bodyContent: "",
            authType: "none",
          },
          {
            id: "req-rest-pikachu",
            name: "Get Pikachu details",
            url: "{{ BASE_URL }}/pokemon/pikachu",
            method: "GET",
            headers: [{ key: "Accept", value: "application/json", enabled: true }],
            queryParams: [],
            bodyType: "none",
            bodyContent: "",
            authType: "none",
          },
        ],
      },
      {
        id: "f-sse",
        name: "SSE",
        isExpanded: true,
        requests: [
          {
            id: "req-sse-stream",
            name: "Endless stream",
            url: "https://httpbin.org/stream/5",
            method: "GET",
            headers: [{ key: "Accept", value: "text/event-stream", enabled: true }],
            queryParams: [],
            bodyType: "none",
            bodyContent: "",
            authType: "none",
          },
          {
            id: "req-sse-stop-n",
            name: "Stop after N token",
            url: "https://httpbin.org/stream-bytes/1024",
            method: "GET",
            headers: [],
            queryParams: [],
            bodyType: "none",
            bodyContent: "",
            authType: "none",
          },
          {
            id: "req-sse-speed",
            name: "Slow it down or speed up",
            url: "https://httpbin.org/delay/2",
            method: "GET",
            headers: [],
            queryParams: [],
            bodyType: "none",
            bodyContent: "",
            authType: "none",
          },
        ],
      },
      {
        id: "f-graphql",
        name: "GraphQL",
        isExpanded: true,
        requests: [
          {
            id: "req-gql-get",
            name: "Get Pokémon",
            url: "{{ GRAPHQL_URL }}",
            method: "GQL",
            headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
            queryParams: [],
            bodyType: "graphql",
            bodyContent: `query GetPokemon($name: String!) {\n  pokemon(name: $name) {\n    id\n    name\n    types\n  }\n}`,
            authType: "none",
            variables: { name: "squirtle" },
          },
          DEFAULT_POKEMON_REQUEST,
          {
            id: "req-gql-trainer",
            name: "Trainer & Team (nested)",
            url: "{{ GRAPHQL_URL }}",
            method: "GQL",
            headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
            queryParams: [],
            bodyType: "graphql",
            bodyContent: `query GetTrainerTeam($trainerId: ID!) {\n  trainer(id: $trainerId) {\n    name\n    badges\n    team {\n      name\n      level\n    }\n  }\n}`,
            authType: "none",
            variables: { trainerId: "ash-ketchum-1" },
          },
        ],
      },
      {
        id: "f-grpc",
        name: "gRPC",
        isExpanded: false,
        requests: [
          {
            id: "req-grpc-pokemon",
            name: "PokemonService.GetPokemon",
            url: "grpc://localhost:50051/pokemon.v1.PokemonService/GetPokemon",
            method: "GRPC",
            headers: [],
            queryParams: [],
            bodyType: "json",
            bodyContent: `{\n  "pokemon_id": 25\n}`,
            authType: "none",
          },
        ],
      },
      {
        id: "f-ws",
        name: "WebSocket",
        isExpanded: false,
        requests: [
          {
            id: "req-ws-echo",
            name: "Live Battle Stream",
            url: "wss://echo.websocket.events",
            method: "WS",
            headers: [],
            queryParams: [],
            bodyType: "json",
            bodyContent: `{\n  "action": "subscribe",\n  "channel": "battles"\n}`,
            authType: "none",
          },
        ],
      },
      {
        id: "f-auth",
        name: "Auth",
        isExpanded: false,
        requests: [
          {
            id: "req-auth-login",
            name: "OAuth 2.0 Token Exchange",
            url: "https://httpbin.org/post",
            method: "POST",
            headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
            queryParams: [],
            bodyType: "json",
            bodyContent: `{\n  "grant_type": "client_credentials"\n}`,
            authType: "bearer",
            bearerToken: "{{ API_KEY }}",
          },
        ],
      },
    ],
  },
];

const DEFAULT_ENVIRONMENTS: ApiEnvironment[] = [
  {
    id: "env-prod",
    name: "Production",
    color: "red",
    variables: {
      BASE_URL: "https://pokeapi.co/api/v2",
      GRAPHQL_URL: "https://graphql.org/graphql",
      API_KEY: "prod_live_sec_991823",
    },
  },
  {
    id: "env-staging",
    name: "Staging",
    color: "yellow",
    variables: {
      BASE_URL: "https://staging.pokeapi.co/api/v2",
      GRAPHQL_URL: "https://staging.graphql.org/graphql",
      API_KEY: "staging_sec_4410",
    },
  },
  {
    id: "env-local",
    name: "Local",
    color: "green",
    variables: {
      BASE_URL: "http://localhost:3000/api",
      GRAPHQL_URL: "http://localhost:4000/graphql",
      API_KEY: "local_dev_token",
    },
  },
  {
    id: "env-default",
    name: "Default",
    color: "zinc",
    variables: {
      BASE_URL: "https://httpbin.org",
      GRAPHQL_URL: "https://graphql.org/graphql",
    },
  },
];

const DEFAULT_WEBHOOK: ApiWebhookDispatch = {
  targetUrl: "http://localhost:3000/api/webhooks/stripe",
  service: "stripe",
  eventType: "payment_intent.succeeded",
  payload: WEBHOOK_PRESETS[0].payload,
  secret: "whsec_test_secret_key_12345",
  duplicateCount: 1,
  delayMsBetweenDuplicates: 50,
};

export const useApiClientStore = create<ApiClientStore>()(
  persist(
    (set, get) => ({
      activeTab: "request",
      activeRequest: DEFAULT_POKEMON_REQUEST,
      activeResponse: null,
      isLoading: false,
      error: null,
      history: [],

      // Sidebar and UI state
      sidebarCollapsed: false,
      variablesDrawerOpen: false,

      // Collections & Workspace Explorer
      collections: DEFAULT_COLLECTIONS,
      activeCollectionId: DEFAULT_COLLECTIONS[0].id,
      environments: DEFAULT_ENVIRONMENTS,
      activeEnvironmentId: DEFAULT_ENVIRONMENTS[0].id,

      // Discovery State
      discoveryUrl: "https://pokeapi.co/api/v2",
      isDiscovering: false,
      discoveryResult: null,

      // Webhook State
      webhookConfig: DEFAULT_WEBHOOK,
      webhookResult: null,
      isDispatchingWebhook: false,

      // Scenario State
      activeScenario: null,
      scenarioResult: null,
      isRunningScenario: false,

      setActiveTab: (activeTab) => set({ activeTab }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      toggleVariablesDrawer: () => set((state) => ({ variablesDrawerOpen: !state.variablesDrawerOpen })),

      // Collection & Workspace Actions
      setActiveCollection: (id) => set({ activeCollectionId: id }),

      createCollection: (name, description) =>
        set((state) => {
          const newCol: ApiCollection = {
            id: `col-${Date.now()}`,
            name,
            description,
            folders: [],
            requests: [],
          };
          return {
            collections: [...state.collections, newCol],
            activeCollectionId: newCol.id,
          };
        }),

      deleteCollection: (id) =>
        set((state) => {
          const filtered = state.collections.filter((c) => c.id !== id);
          return {
            collections: filtered,
            activeCollectionId: filtered[0]?.id || "",
          };
        }),

      createFolder: (collectionId, name) =>
        set((state) => ({
          collections: state.collections.map((col) => {
            if (col.id !== collectionId) return col;
            const newFolder: ApiFolder = {
              id: `folder-${Date.now()}`,
              name,
              isExpanded: true,
              requests: [],
            };
            return {
              ...col,
              folders: [...col.folders, newFolder],
            };
          }),
        })),

      toggleFolder: (collectionId, folderId) =>
        set((state) => ({
          collections: state.collections.map((col) => {
            if (col.id !== collectionId) return col;
            return {
              ...col,
              folders: col.folders.map((f) =>
                f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f,
              ),
            };
          }),
        })),

      deleteFolder: (collectionId, folderId) =>
        set((state) => ({
          collections: state.collections.map((col) => {
            if (col.id !== collectionId) return col;
            return {
              ...col,
              folders: col.folders.filter((f) => f.id !== folderId),
            };
          }),
        })),

      createRequest: (collectionId, folderId, req) =>
        set((state) => {
          const targetColId = collectionId || state.activeCollectionId || state.collections[0]?.id;
          const newReq: ApiRequest = {
            id: `req-${Date.now()}`,
            name: req?.name || "New Endpoint",
            url: req?.url || "https://httpbin.org/get",
            method: req?.method || "GET",
            headers: req?.headers || [{ key: "Accept", value: "application/json", enabled: true }],
            queryParams: req?.queryParams || [],
            bodyType: req?.bodyType || "none",
            bodyContent: req?.bodyContent || "",
            authType: req?.authType || "none",
            ...req,
          };

          const updatedCollections = state.collections.map((col) => {
            if (col.id !== targetColId) return col;
            if (folderId) {
              return {
                ...col,
                folders: col.folders.map((f) =>
                  f.id === folderId ? { ...f, requests: [...f.requests, newReq] } : f,
                ),
              };
            }
            return {
              ...col,
              requests: [...col.requests, newReq],
            };
          });

          return {
            collections: updatedCollections,
            activeRequest: newReq,
            activeTab: "request",
          };
        }),

      selectRequest: (req) =>
        set({
          activeRequest: { ...req },
          activeTab: "request",
        }),

      deleteRequest: (requestId) =>
        set((state) => {
          const updatedCollections = state.collections.map((col) => ({
            ...col,
            requests: col.requests.filter((r) => r.id !== requestId),
            folders: col.folders.map((f) => ({
              ...f,
              requests: f.requests.filter((r) => r.id !== requestId),
            })),
          }));
          return { collections: updatedCollections };
        }),

      renameRequest: (requestId, name) =>
        set((state) => {
          const updatedCollections = state.collections.map((col) => ({
            ...col,
            requests: col.requests.map((r) => (r.id === requestId ? { ...r, name } : r)),
            folders: col.folders.map((f) => ({
              ...f,
              requests: f.requests.map((r) => (r.id === requestId ? { ...r, name } : r)),
            })),
          }));

          const updatedActive =
            state.activeRequest.id === requestId
              ? { ...state.activeRequest, name }
              : state.activeRequest;

          return { collections: updatedCollections, activeRequest: updatedActive };
        }),

      // Environment Actions
      setEnvironment: (id) => set({ activeEnvironmentId: id }),

      createEnvironment: (name, color = "blue") =>
        set((state) => {
          const newEnv: ApiEnvironment = {
            id: `env-${Date.now()}`,
            name,
            color,
            variables: {},
          };
          return {
            environments: [...state.environments, newEnv],
            activeEnvironmentId: newEnv.id,
          };
        }),

      updateEnvironmentVariable: (envId, key, value) =>
        set((state) => ({
          environments: state.environments.map((env) =>
            env.id === envId
              ? { ...env, variables: { ...env.variables, [key]: value } }
              : env,
          ),
        })),

      deleteEnvironmentVariable: (envId, key) =>
        set((state) => ({
          environments: state.environments.map((env) => {
            if (env.id !== envId) return env;
            const rest = { ...env.variables };
            delete rest[key];
            return { ...env, variables: rest };
          }),
        })),

      setRequestVariables: (variables) =>
        set((state) => ({
          activeRequest: { ...state.activeRequest, variables },
        })),

      setUrl: (url) =>
        set((state) => ({
          activeRequest: { ...state.activeRequest, url },
        })),

      setMethod: (method) =>
        set((state) => ({
          activeRequest: { ...state.activeRequest, method },
        })),

      addHeader: () =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            headers: [
              ...state.activeRequest.headers,
              { key: "", value: "", enabled: true },
            ],
          },
        })),

      updateHeader: (index, patch) =>
        set((state) => {
          const newHeaders = [...state.activeRequest.headers];
          if (newHeaders[index]) {
            newHeaders[index] = { ...newHeaders[index], ...patch };
          }
          return {
            activeRequest: { ...state.activeRequest, headers: newHeaders },
          };
        }),

      removeHeader: (index) =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            headers: state.activeRequest.headers.filter((_, i) => i !== index),
          },
        })),

      addQueryParam: () =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            queryParams: [
              ...state.activeRequest.queryParams,
              { key: "", value: "", enabled: true },
            ],
          },
        })),

      updateQueryParam: (index, patch) =>
        set((state) => {
          const newParams = [...state.activeRequest.queryParams];
          if (newParams[index]) {
            newParams[index] = { ...newParams[index], ...patch };
          }
          return {
            activeRequest: { ...state.activeRequest, queryParams: newParams },
          };
        }),

      removeQueryParam: (index) =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            queryParams: state.activeRequest.queryParams.filter(
              (_, i) => i !== index,
            ),
          },
        })),

      setBodyType: (bodyType) =>
        set((state) => ({
          activeRequest: { ...state.activeRequest, bodyType },
        })),

      setBodyContent: (bodyContent) =>
        set((state) => ({
          activeRequest: { ...state.activeRequest, bodyContent },
        })),

      setAuthType: (authType) =>
        set((state) => ({
          activeRequest: { ...state.activeRequest, authType },
        })),

      setBearerToken: (bearerToken) =>
        set((state) => ({
          activeRequest: { ...state.activeRequest, bearerToken },
        })),

      setApiKey: (key, value, inHeader) =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            apiKey: { key, value, inHeader },
          },
        })),

      setBasicAuth: (username, password) =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            basicAuth: { username, password },
          },
        })),

      setOAuth2: (token, tokenType) =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            oauth2: { token, tokenType },
          },
        })),

      setAwsSigV4: (awsSigV4) =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            awsSigV4,
          },
        })),

      setDigestAuth: (username, password) =>
        set((state) => ({
          activeRequest: {
            ...state.activeRequest,
            digestAuth: { username, password },
          },
        })),

      cancelRequest: async () => {
        const { activeRequest } = get();
        if (activeRequest.id) {
          await cancelApiRequest(activeRequest.id);
        }
        set({ isLoading: false });
      },

      importPostman: (jsonContent: string) => {
        const result = parsePostmanCollection(jsonContent);
        if (result.requests.length > 0) {
          const first = result.requests[0];
          const newCol: ApiCollection = {
            id: `col-postman-${Date.now()}`,
            name: result.collectionName || "Postman Import",
            description: `Imported with ${result.requests.length} endpoints`,
            folders: [
              {
                id: `folder-imported-${Date.now()}`,
                name: "Imported Requests",
                isExpanded: true,
                requests: result.requests,
              },
            ],
            requests: [],
          };

          set((state) => ({
            collections: [newCol, ...state.collections],
            activeCollectionId: newCol.id,
            activeRequest: first,
            activeTab: "request",
          }));
        }
        return { count: result.requests.length, name: result.collectionName };
      },

      sendRequest: async () => {
        const { activeRequest } = get();
        set({ isLoading: true, error: null });

        try {
          const response = await sendApiRequest(activeRequest);
          set((state) => ({
            activeResponse: response,
            isLoading: false,
            history: [
              {
                request: { ...activeRequest },
                response,
                timestamp: Date.now(),
              },
              ...state.history.slice(0, 49),
            ],
          }));
          return response;
        } catch (err) {
          const errorMsg = String(err);
          set({
            isLoading: false,
            error: errorMsg,
            activeResponse: {
              status: 0,
              statusText: "Client Error",
              headers: [],
              body: errorMsg,
              bodyBytesLen: errorMsg.length,
              isJson: false,
              timings: { totalDurationMs: 0 },
              error: errorMsg,
              timestamp: Date.now(),
            },
          });
          return null;
        }
      },

      loadFromHistory: (index) => {
        const { history } = get();
        const item = history[index];
        if (item) {
          set({
            activeRequest: { ...item.request },
            activeResponse: item.response ? { ...item.response } : null,
            activeTab: "request",
          });
        }
      },

      clearHistory: () => set({ history: [] }),

      // Discovery actions
      setDiscoveryUrl: (discoveryUrl) => set({ discoveryUrl }),

      runDiscovery: async (targetUrl) => {
        const { discoveryUrl, activeRequest } = get();
        const urlToScan = targetUrl || discoveryUrl || activeRequest.url;
        set({ isDiscovering: true });

        try {
          const res = await discoverApiEndpoints(
            urlToScan,
            activeRequest.headers,
            activeRequest.apiKey,
            activeRequest.bearerToken,
          );
          set({
            discoveryResult: res,
            discoveryUrl: urlToScan,
            isDiscovering: false,
          });
          return res;
        } catch (err) {
          set({ isDiscovering: false });
          return null;
        }
      },

      loadEndpointToEditor: (endpoint) => {
        const { activeRequest } = get();
        set({
          activeRequest: {
            ...activeRequest,
            url: endpoint.fullUrl,
            method: endpoint.method,
            bodyType: endpoint.sampleBody ? "json" : activeRequest.bodyType,
            bodyContent: endpoint.sampleBody || activeRequest.bodyContent,
          },
          activeTab: "request",
        });
      },

      // Webhook actions
      setWebhookTargetUrl: (targetUrl) =>
        set((state) => ({
          webhookConfig: { ...state.webhookConfig, targetUrl },
        })),

      setWebhookService: (service) =>
        set((state) => ({
          webhookConfig: { ...state.webhookConfig, service },
        })),

      setWebhookEventType: (eventType) =>
        set((state) => ({
          webhookConfig: { ...state.webhookConfig, eventType },
        })),

      setWebhookPayload: (payload) =>
        set((state) => ({
          webhookConfig: { ...state.webhookConfig, payload },
        })),

      setWebhookSecret: (secret) =>
        set((state) => ({
          webhookConfig: { ...state.webhookConfig, secret },
        })),

      setWebhookDuplicateCount: (duplicateCount) =>
        set((state) => ({
          webhookConfig: { ...state.webhookConfig, duplicateCount },
        })),

      applyWebhookPreset: (preset) =>
        set((state) => ({
          webhookConfig: {
            ...state.webhookConfig,
            service: preset.service,
            eventType: preset.eventType,
            payload: preset.payload,
            secret: preset.defaultSecret,
          },
        })),

      triggerWebhookDispatch: async () => {
        const { webhookConfig } = get();
        set({ isDispatchingWebhook: true });

        try {
          const res = await dispatchMockWebhook(webhookConfig);
          set({ webhookResult: res, isDispatchingWebhook: false });
          return res;
        } catch (err) {
          const errorSummary = `Dispatch failed: ${String(err)}`;
          set({
            webhookResult: {
              targetUrl: webhookConfig.targetUrl,
              service: webhookConfig.service,
              eventType: webhookConfig.eventType,
              attempts: [
                {
                  attempt: 1,
                  status: 0,
                  durationMs: 0,
                  responseBody: errorSummary,
                  success: false,
                },
              ],
              isIdempotent: false,
              summary: errorSummary,
            },
            isDispatchingWebhook: false,
          });
          return null;
        }
      },

      executeScenario: async (scenario) => {
        set({ isRunningScenario: true, activeScenario: scenario });

        try {
          const res = await runApiScenario(scenario);
          set({ scenarioResult: res, isRunningScenario: false });
          return res;
        } catch (err) {
          set({ isRunningScenario: false });
          return null;
        }
      },
    }),
    {
      name: "voktty-api-client-storage",
      partialize: (state) => ({
        activeRequest: state.activeRequest,
        webhookConfig: state.webhookConfig,
        discoveryUrl: state.discoveryUrl,
        history: state.history.slice(0, 30),
      }),
    },
  ),
);
