import { beforeEach, describe, expect, it } from "vitest";
import { WEBHOOK_PRESETS } from "../lib/presets";
import { useApiClientStore } from "./apiClientStore";

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
});
