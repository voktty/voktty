import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ApiMethod,
  ApiRequest,
  ApiResponse,
  ApiScenario,
  ApiScenarioResult,
  ApiWebhookDispatch,
  ApiWebhookResult,
  KeyValueParam,
} from "../types";
import {
  dispatchMockWebhook,
  runApiScenario,
  sendApiRequest,
} from "../lib/apiTauriBridge";
import { WEBHOOK_PRESETS, type WebhookPreset } from "../lib/presets";

export type ApiClientStore = {
  activeTab: "request" | "sandbox" | "scenarios" | "history";
  activeRequest: ApiRequest;
  activeResponse: ApiResponse | null;
  isLoading: boolean;
  error: string | null;

  // History
  history: { request: ApiRequest; response?: ApiResponse; timestamp: number }[];

  // Sandbox Webhook State
  webhookConfig: ApiWebhookDispatch;
  webhookResult: ApiWebhookResult | null;
  isDispatchingWebhook: boolean;

  // Scenario Runner State
  activeScenario: ApiScenario | null;
  scenarioResult: ApiScenarioResult | null;
  isRunningScenario: boolean;

  // Actions
  setActiveTab: (tab: "request" | "sandbox" | "scenarios" | "history") => void;
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

  sendRequest: () => Promise<ApiResponse | null>;
  loadFromHistory: (index: number) => void;
  clearHistory: () => void;

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

const DEFAULT_REQUEST: ApiRequest = {
  id: "default-req-1",
  name: "New Request",
  url: "https://httpbin.org/get",
  method: "GET",
  headers: [
    { key: "Accept", value: "application/json", enabled: true },
    { key: "User-Agent", value: "Voktty-ApiClient/1.0", enabled: true },
  ],
  queryParams: [],
  bodyType: "none",
  bodyContent: "{\n  \"message\": \"hello from voktty\"\n}",
  authType: "none",
};

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
      activeRequest: DEFAULT_REQUEST,
      activeResponse: null,
      isLoading: false,
      error: null,
      history: [],

      webhookConfig: DEFAULT_WEBHOOK,
      webhookResult: null,
      isDispatchingWebhook: false,

      activeScenario: null,
      scenarioResult: null,
      isRunningScenario: false,

      setActiveTab: (activeTab) => set({ activeTab }),

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
          const headers = [...state.activeRequest.headers];
          if (headers[index]) {
            headers[index] = { ...headers[index], ...patch };
          }
          return { activeRequest: { ...state.activeRequest, headers } };
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
          const queryParams = [...state.activeRequest.queryParams];
          if (queryParams[index]) {
            queryParams[index] = { ...queryParams[index], ...patch };
          }
          return { activeRequest: { ...state.activeRequest, queryParams } };
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

      sendRequest: async () => {
        const { activeRequest, history } = get();
        set({ isLoading: true, error: null });

        try {
          const response = await sendApiRequest(activeRequest);
          set({
            activeResponse: response,
            isLoading: false,
            history: [
              {
                request: { ...activeRequest },
                response,
                timestamp: Date.now(),
              },
              ...history.slice(0, 49),
            ],
          });
          return response;
        } catch (err) {
          const errorMsg = String(err);
          set({
            error: errorMsg,
            isLoading: false,
            activeResponse: {
              status: 0,
              statusText: "Error",
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
        const item = get().history[index];
        if (item) {
          set({
            activeRequest: { ...item.request },
            activeResponse: item.response ?? null,
            activeTab: "request",
          });
        }
      },

      clearHistory: () => set({ history: [] }),

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
        history: state.history.slice(0, 30),
      }),
    },
  ),
);
