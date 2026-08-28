export type ApiMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "GQL"
  | "SSE"
  | "GRPC"
  | "WS";

export type KeyValueParam = {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
};

export type ApiAuthType =
  | "none"
  | "bearer"
  | "apiKey"
  | "basic"
  | "oauth2"
  | "awsSigV4"
  | "digest";

export type ApiRequestBodyType =
  | "none"
  | "json"
  | "text"
  | "form-urlencoded"
  | "raw"
  | "graphql";

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
  oauth2?: {
    token: string;
    tokenType?: string;
  };
  awsSigV4?: {
    accessKey: string;
    secretKey: string;
    region: string;
    service: string;
    sessionToken?: string;
  };
  digestAuth?: {
    username: string;
    password: string;
  };
  timeoutMs?: number;
  variables?: Record<string, string>;
  isDirty?: boolean;
};

export type ApiFolder = {
  id: string;
  name: string;
  isExpanded?: boolean;
  requests: ApiRequest[];
  folders?: ApiFolder[];
};

export type ApiCollection = {
  id: string;
  name: string;
  description?: string;
  folders: ApiFolder[];
  requests: ApiRequest[];
};

export type ApiEnvironment = {
  id: string;
  name: string;
  color: "red" | "yellow" | "green" | "blue" | "zinc";
  variables: Record<string, string>;
};

export type ApiTimings = {
  dnsLookupMs?: number;
  tcpConnectMs?: number;
  tlsHandshakeMs?: number;
  firstByteMs?: number;
  downloadMs?: number;
  totalDurationMs: number;
};

export type ApiStreamEvent =
  | { type: "Status"; data: { code: number; reason: string } }
  | { type: "Header"; data: { key: string; value: string } }
  | { type: "Chunk"; data: { data: string; bytes_len: number } }
  | { type: "Done"; data: { total_bytes: number; duration_ms: number } }
  | { type: "Error"; data: { message: string } };

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

export type DiscoveredEndpoint = {
  path: string;
  fullUrl: string;
  method: ApiMethod;
  status?: number;
  statusText?: string;
  durationMs?: number;
  description?: string;
  requiresAuth?: boolean;
  sampleBody?: string;
  source: "openapi" | "fingerprint" | "probe";
};

export type ApiClientTabMode =
  | "request"
  | "browser"
  | "sandbox"
  | "scenarios"
  | "history";

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
