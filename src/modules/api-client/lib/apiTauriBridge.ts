import { invoke } from "@tauri-apps/api/core";
import type {
  ApiRequest,
  ApiResponse,
  ApiScenario,
  ApiScenarioResult,
  ApiWebhookDispatch,
  ApiWebhookResult,
} from "../types";

export async function sendApiRequest(request: ApiRequest): Promise<ApiResponse> {
  const headersObj: Record<string, string> = {};
  for (const h of request.headers) {
    if (h.enabled && h.key) {
      headersObj[h.key] = h.value;
    }
  }

  const queryParams = request.queryParams
    .filter((q) => q.enabled && q.key)
    .map((q) => ({
      key: q.key,
      value: q.value,
      enabled: q.enabled,
    }));

  let bodyPayload:
    | { type: "None" }
    | { type: "Json"; value: unknown }
    | { type: "Text"; value: string }
    | { type: "FormUrlEncoded"; value: { key: string; value: string; enabled: boolean }[] }
    | { type: "Raw"; value: { content: string; content_type: string } } = { type: "None" };

  let rustMethod: string = request.method;
  if (rustMethod === "GQL") rustMethod = "POST";
  else if (rustMethod === "SSE") rustMethod = "GET";
  else if (rustMethod === "GRPC" || rustMethod === "WS") rustMethod = "POST";

  if (request.bodyType === "graphql" && request.bodyContent.trim()) {
    bodyPayload = {
      type: "Json",
      value: {
        query: request.bodyContent,
        variables: request.variables || {},
      },
    };
    if (!headersObj["Content-Type"]) {
      headersObj["Content-Type"] = "application/json";
    }
  } else if (request.bodyType === "json" && request.bodyContent.trim()) {
    try {
      const parsed = JSON.parse(request.bodyContent);
      bodyPayload = { type: "Json", value: parsed };
    } catch {
      bodyPayload = { type: "Text", value: request.bodyContent };
    }
  } else if (request.bodyType === "text" && request.bodyContent.trim()) {
    bodyPayload = { type: "Text", value: request.bodyContent };
  } else if (request.bodyType === "form-urlencoded" && request.bodyContent.trim()) {
    // Parse key=value lines
    const params = request.bodyContent
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("=");
        if (idx === -1) return null;
        return {
          key: line.slice(0, idx).trim(),
          value: line.slice(idx + 1).trim(),
          enabled: true,
        };
      })
      .filter((p): p is { key: string; value: string; enabled: boolean } => p !== null);
    bodyPayload = { type: "FormUrlEncoded", value: params };
  }

  let authPayload:
    | { type: "None" }
    | { type: "Bearer"; token: string }
    | { type: "ApiKey"; key: string; value: string; in_header: boolean }
    | { type: "Basic"; username: string; password: string }
    | { type: "OAuth2"; token: string; token_type?: string }
    | {
        type: "AwsSigV4";
        access_key: string;
        secret_key: string;
        region: string;
        service: string;
        session_token?: string;
      }
    | { type: "Digest"; username: string; password: string } = { type: "None" };

  if (request.authType === "bearer" && request.bearerToken) {
    authPayload = { type: "Bearer", token: request.bearerToken };
  } else if (request.authType === "oauth2" && request.oauth2) {
    authPayload = {
      type: "OAuth2",
      token: request.oauth2.token,
      token_type: request.oauth2.tokenType,
    };
  } else if (request.authType === "awsSigV4" && request.awsSigV4) {
    authPayload = {
      type: "AwsSigV4",
      access_key: request.awsSigV4.accessKey,
      secret_key: request.awsSigV4.secretKey,
      region: request.awsSigV4.region,
      service: request.awsSigV4.service,
      session_token: request.awsSigV4.sessionToken,
    };
  } else if (request.authType === "digest" && request.digestAuth) {
    authPayload = {
      type: "Digest",
      username: request.digestAuth.username,
      password: request.digestAuth.password,
    };
  } else if (request.authType === "apiKey" && request.apiKey) {
    authPayload = {
      type: "ApiKey",
      key: request.apiKey.key,
      value: request.apiKey.value,
      in_header: request.apiKey.inHeader,
    };
  } else if (request.authType === "basic" && request.basicAuth) {
    authPayload = {
      type: "Basic",
      username: request.basicAuth.username,
      password: request.basicAuth.password,
    };
  }

  const raw = await invoke<{
    request_id?: string;
    status: number;
    status_text: string;
    headers: [string, string][];
    body: string;
    body_bytes_len: number;
    is_json: boolean;
    json_value?: unknown;
    timings: {
      dns_lookup_ms?: number;
      tcp_connect_ms?: number;
      tls_handshake_ms?: number;
      first_byte_ms?: number;
      download_ms?: number;
      total_duration_ms: number;
    };
    error?: string;
  }>("api_client_send_request", {
    request: {
      id: request.id,
      url: request.url,
      method: rustMethod,
      headers: headersObj,
      query_params: queryParams,
      body: bodyPayload,
      auth: authPayload,
      timeout_ms: request.timeoutMs ?? 30000,
      follow_redirects: true,
      insecure_skip_verify: false,
      variables: request.variables,
      is_agent_call: false,
    },
  });

  return {
    requestId: raw.request_id,
    status: raw.status,
    statusText: raw.status_text,
    headers: raw.headers,
    body: raw.body,
    bodyBytesLen: raw.body_bytes_len,
    isJson: raw.is_json,
    jsonValue: raw.json_value,
    timings: {
      dnsLookupMs: raw.timings.dns_lookup_ms,
      tcpConnectMs: raw.timings.tcp_connect_ms,
      tlsHandshakeMs: raw.timings.tls_handshake_ms,
      firstByteMs: raw.timings.first_byte_ms,
      downloadMs: raw.timings.download_ms,
      totalDurationMs: raw.timings.total_duration_ms,
    },
    error: raw.error,
    timestamp: Date.now(),
  };
}

export async function cancelApiRequest(requestId: string): Promise<boolean> {
  return await invoke<boolean>("api_client_cancel_request", { requestId });
}

export async function dispatchMockWebhook(
  dispatch: ApiWebhookDispatch,
): Promise<ApiWebhookResult> {
  const raw = await invoke<{
    target_url: string;
    service: string;
    event_type: string;
    attempts: {
      attempt: number;
      status: number;
      duration_ms: number;
      response_body: string;
      success: boolean;
    }[];
    is_idempotent: boolean;
    summary: string;
  }>("api_client_dispatch_webhook", {
    webhook: {
      target_url: dispatch.targetUrl,
      service: dispatch.service,
      event_type: dispatch.eventType,
      payload: dispatch.payload,
      secret: dispatch.secret,
      duplicate_count: dispatch.duplicateCount ?? 1,
      delay_ms_between_duplicates: dispatch.delayMsBetweenDuplicates ?? 50,
    },
  });

  return {
    targetUrl: raw.target_url,
    service: raw.service,
    eventType: raw.event_type,
    attempts: raw.attempts.map((a) => ({
      attempt: a.attempt,
      status: a.status,
      durationMs: a.duration_ms,
      responseBody: a.response_body,
      success: a.success,
    })),
    isIdempotent: raw.is_idempotent,
    summary: raw.summary,
  };
}

export async function runApiScenario(
  scenario: ApiScenario,
): Promise<ApiScenarioResult> {
  const raw = await invoke<{
    scenario_name: string;
    service: string;
    passed: boolean;
    total_steps: number;
    passed_steps: number;
    failed_steps: number;
    step_results: {
      step_id: string;
      step_name: string;
      step_kind: string;
      passed: boolean;
      response?: {
        request_id?: string;
        status: number;
        status_text: string;
        headers: [string, string][];
        body: string;
        body_bytes_len: number;
        is_json: boolean;
        json_value?: unknown;
        timings: { total_duration_ms: number };
        error?: string;
      };
      webhook_result?: {
        target_url: string;
        service: string;
        event_type: string;
        attempts: {
          attempt: number;
          status: number;
          duration_ms: number;
          response_body: string;
          success: boolean;
        }[];
        is_idempotent: boolean;
        summary: string;
      };
      assertions: {
        assertion: {
          property: "status" | "latency_ms" | "body_contains";
          target?: string;
          operator: "equals" | "not_equals" | "less_than" | "greater_than" | "contains";
          expected: unknown;
        };
        passed: boolean;
        actual?: unknown;
        message: string;
      }[];
      duration_ms: number;
    }[];
    total_duration_ms: number;
  }>("api_client_run_scenario", {
    scenario: {
      name: scenario.name,
      service: scenario.service,
      steps: scenario.steps.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        request: s.request
          ? {
              id: s.request.id,
              url: s.request.url,
              method: s.request.method,
              headers: Object.fromEntries(
                s.request.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, h.value]),
              ),
              query_params: s.request.queryParams.filter((q) => q.enabled && q.key),
              body: { type: "None" },
              auth: { type: "None" },
              timeout_ms: 30000,
              follow_redirects: true,
              insecure_skip_verify: false,
            }
          : undefined,
        webhook: s.webhook
          ? {
              target_url: s.webhook.targetUrl,
              service: s.webhook.service,
              event_type: s.webhook.eventType,
              payload: s.webhook.payload,
              secret: s.webhook.secret,
              duplicate_count: s.webhook.duplicateCount ?? 1,
              delay_ms_between_duplicates: s.webhook.delayMsBetweenDuplicates ?? 50,
            }
          : undefined,
        assertions: s.assertions,
      })),
    },
  });

  return {
    scenarioName: raw.scenario_name,
    service: raw.service,
    passed: raw.passed,
    totalSteps: raw.total_steps,
    passedSteps: raw.passed_steps,
    failedSteps: raw.failed_steps,
    totalDurationMs: raw.total_duration_ms,
    timestamp: Date.now(),
    stepResults: raw.step_results.map((sr) => ({
      stepId: sr.step_id,
      stepName: sr.step_name,
      stepKind: sr.step_kind,
      passed: sr.passed,
      durationMs: sr.duration_ms,
      response: sr.response
        ? {
            requestId: sr.response.request_id,
            status: sr.response.status,
            statusText: sr.response.status_text,
            headers: sr.response.headers,
            body: sr.response.body,
            bodyBytesLen: sr.response.body_bytes_len,
            isJson: sr.response.is_json,
            jsonValue: sr.response.json_value,
            timings: { totalDurationMs: sr.response.timings.total_duration_ms },
            error: sr.response.error,
            timestamp: Date.now(),
          }
        : undefined,
      webhookResult: sr.webhook_result
        ? {
            targetUrl: sr.webhook_result.target_url,
            service: sr.webhook_result.service,
            eventType: sr.webhook_result.event_type,
            attempts: sr.webhook_result.attempts.map((att) => ({
              attempt: att.attempt,
              status: att.status,
              durationMs: att.duration_ms,
              responseBody: att.response_body,
              success: att.success,
            })),
            isIdempotent: sr.webhook_result.is_idempotent,
            summary: sr.webhook_result.summary,
          }
        : undefined,
      assertions: sr.assertions,
    })),
  };
}
