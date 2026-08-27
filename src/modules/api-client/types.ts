export type ApiMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type KeyValueParam = {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
};

export type ApiAuthType = "none" | "bearer" | "apiKey" | "basic";

export type ApiRequestBodyType = "none" | "json" | "text" | "form-urlencoded" | "raw";

export type ApiRequest = {
  id: string;
  name: string;
  url: string;
  method: ApiMethod;
  headers: KeyValueParam[];
  queryParams: KeyValueParam[];
  bodyType: ApiRequestBodyType;
  bodyContent: string;
  authType: ApiAuthType;
  bearerToken?: string;
  apiKey?: {
    key: string;
    value: string;
    inHeader: boolean;
  };
  basicAuth?: {
    username: string;
    password: string;
  };
  timeoutMs?: number;
};

export type ApiTimings = {
  totalDurationMs: number;
};

export type ApiResponse = {
  requestId?: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  bodyBytesLen: number;
  isJson: boolean;
  jsonValue?: unknown;
  timings: ApiTimings;
  error?: string;
  timestamp: number;
};

export type ApiWebhookDispatch = {
  targetUrl: string;
  service: string;
  eventType: string;
  payload: Record<string, unknown>;
  secret?: string;
  duplicateCount?: number;
  delayMsBetweenDuplicates?: number;
};

export type ApiWebhookAttemptResult = {
  attempt: number;
  status: number;
  durationMs: number;
  responseBody: string;
  success: boolean;
};

export type ApiWebhookResult = {
  targetUrl: string;
  service: string;
  eventType: string;
  attempts: ApiWebhookAttemptResult[];
  isIdempotent: boolean;
  summary: string;
};

export type ApiAssertion = {
  property: "status" | "latency_ms" | "body_contains";
  target?: string;
  operator: "equals" | "not_equals" | "less_than" | "greater_than" | "contains";
  expected: unknown;
};

export type ApiAssertionResult = {
  assertion: ApiAssertion;
  passed: boolean;
  actual?: unknown;
  message: string;
};

export type ApiScenarioStep = {
  id: string;
  name: string;
  kind: "request" | "webhook";
  request?: ApiRequest;
  webhook?: ApiWebhookDispatch;
  assertions: ApiAssertion[];
};

export type ApiScenarioStepResult = {
  stepId: string;
  stepName: string;
  stepKind: string;
  passed: boolean;
  response?: ApiResponse;
  webhookResult?: ApiWebhookResult;
  assertions: ApiAssertionResult[];
  durationMs: number;
};

export type ApiScenario = {
  id: string;
  name: string;
  service: string;
  description?: string;
  steps: ApiScenarioStep[];
};

export type ApiScenarioResult = {
  scenarioName: string;
  service: string;
  passed: boolean;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  stepResults: ApiScenarioStepResult[];
  totalDurationMs: number;
  timestamp: number;
};
