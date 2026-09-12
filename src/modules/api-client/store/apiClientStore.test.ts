import { beforeEach, describe, expect, it } from "vitest";
import { WEBHOOK_PRESETS } from "../lib/presets";
import {
  createApiClientStore,
  createApiHistoryResponsePreview,
  getApiClientPersistedState,
  getLegacyApiClientPresentationState,
  useApiClientStore,
} from "./apiClientStore";

describe("apiClientStore", () => {
  beforeEach(() => {
    useApiClientStore.setState({
      activeTab: "request",
      activeRequest: {
        id: "default",
        name: "Untitled Request",
        url: "http://localhost:3000/api/health",
        method: "GET",
        headers: [{ key: "Accept", value: "application/json", enabled: true }],
        queryParams: [],
        bodyType: "none",
        bodyContent: "",
        authType: "none",
      },
      activeResponse: null,
      history: [],
      error: null,
    });
  });

  it("updates request URL and method", () => {
    const store = useApiClientStore.getState();
    store.setUrl("http://localhost:8080/api/v1/auth");
    store.setMethod("POST");

    const state = useApiClientStore.getState();
    expect(state.activeRequest.url).toBe("http://localhost:8080/api/v1/auth");
    expect(state.activeRequest.method).toBe("POST");
  });

  it("adds and updates headers and params", () => {
    const store = useApiClientStore.getState();
    store.addHeader();
    store.updateHeader(1, { key: "Authorization", value: "Bearer token123", enabled: true });

    store.addQueryParam();
    store.updateQueryParam(0, { key: "page", value: "2", enabled: true });

    const state = useApiClientStore.getState();
    expect(state.activeRequest.headers).toHaveLength(2);
    expect(state.activeRequest.headers[1]).toEqual({
      key: "Authorization",
      value: "Bearer token123",
      enabled: true,
    });
    expect(state.activeRequest.queryParams[0]).toEqual({
      key: "page",
      value: "2",
      enabled: true,
    });
  });

  it("loads webhook presets into state", () => {
    const store = useApiClientStore.getState();
    const preset = WEBHOOK_PRESETS[0];
    store.applyWebhookPreset(preset);

    const state = useApiClientStore.getState();
    expect(state.webhookConfig.service).toBe(preset.service);
    expect(state.webhookConfig.eventType).toBe(preset.eventType);
    expect(state.webhookConfig.payload).toHaveProperty("id");
  });

  it("persists only non-sensitive presentation preferences", () => {
    const store = createApiClientStore("api-client-test-persistence");
    const persisted = getApiClientPersistedState(store.getState());

    expect(persisted).toEqual({
      activeTab: "request",
      sidebarCollapsed: false,
      variablesDrawerOpen: false,
    });
    expect(JSON.stringify(persisted)).not.toContain("whsec_");
    expect(JSON.stringify(persisted)).not.toContain("secretKey");
  });

  it("keeps request state independent between tab stores", () => {
    const firstTab = createApiClientStore("api-client-test-tab-1");
    const secondTab = createApiClientStore("api-client-test-tab-2");

    firstTab.getState().setUrl("https://api.example.test/first");
    firstTab.getState().setBearerToken("first-tab-token");

    expect(firstTab.getState().activeRequest.url).toBe("https://api.example.test/first");
    expect(secondTab.getState().activeRequest.url).not.toBe("https://api.example.test/first");
    expect(secondTab.getState().activeRequest.bearerToken).toBeUndefined();
  });

  it("migrates only presentation preferences from legacy storage", () => {
    const legacy = JSON.stringify({
      state: {
        activeTab: "history",
        sidebarCollapsed: true,
        variablesDrawerOpen: true,
        activeRequest: { bearerToken: "legacy-token" },
        webhookConfig: { secret: "whsec_legacy" },
        history: [{ response: { body: "private response" } }],
      },
      version: 0,
    });

    expect(getLegacyApiClientPresentationState(legacy)).toEqual({
      activeTab: "history",
      sidebarCollapsed: true,
      variablesDrawerOpen: true,
    });
  });

  it("ignores malformed or unsupported legacy presentation values", () => {
    expect(getLegacyApiClientPresentationState("not-json")).toEqual({});
    expect(
      getLegacyApiClientPresentationState(
        JSON.stringify({ state: { activeTab: "invalid", sidebarCollapsed: "yes" } }),
      ),
    ).toEqual({});
  });

  it("bounds history response previews without changing the active response", () => {
    const response = {
      status: 200,
      statusText: "OK",
      headers: [],
      body: "x".repeat(70 * 1024),
      bodyBytesLen: 70 * 1024,
      isJson: true,
      jsonValue: { private: "full response" },
      timings: { totalDurationMs: 10 },
      timestamp: 1,
    };

    const preview = createApiHistoryResponsePreview(response);

    expect(new TextEncoder().encode(preview.body).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(preview.body).toContain("[truncated]");
    expect(preview.bodyBytesLen).toBe(70 * 1024);
    expect(preview.jsonValue).toBeUndefined();
    expect(response.jsonValue).toEqual({ private: "full response" });
  });
});
