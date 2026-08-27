import { tool } from "ai";
import { z } from "zod";
import {
  dispatchMockWebhook,
  sendApiRequest,
} from "@/modules/api-client";
import type { ToolContext } from "./context";

export function buildApiClientTools(_ctx: ToolContext) {
  return {
    api_send_request: tool({
      description:
        "Send an HTTP request via Voktty's native Rust HTTP engine (bypasses CORS, supports local servers, public APIs, headers, auth, and payloads). Use this to test endpoints, reproduce bugs, and verify server responses.",
      inputSchema: z.object({
        url: z
          .string()
          .describe(
            "Target URL (e.g. 'http://localhost:3000/api/users' or 'https://api.stripe.com/v1/...')",
          ),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
          .default("GET")
          .describe("HTTP Method"),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Optional key-value HTTP headers"),
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional JSON body object for POST/PUT/PATCH requests"),
        bearer_token: z
          .string()
          .optional()
          .describe("Optional Bearer Authorization token"),
        timeout_ms: z
          .number()
          .optional()
          .describe("Request timeout in milliseconds (default 30000)"),
      }),
      execute: async ({
        url,
        method,
        headers,
        body,
        bearer_token,
        timeout_ms,
      }) => {
        try {
          const headerList = Object.entries(headers ?? {}).map(
            ([key, value]) => ({
              key,
              value: String(value),
              enabled: true,
            }),
          );

          const res = await sendApiRequest({
            id: `agent-req-${Date.now()}`,
            name: `Agent Request ${method} ${url}`,
            url,
            method,
            headers: headerList,
            queryParams: [],
            bodyType: body ? "json" : "none",
            bodyContent: body ? JSON.stringify(body) : "",
            authType: bearer_token ? "bearer" : "none",
            bearerToken: bearer_token,
            timeoutMs: timeout_ms,
          });

          return {
            ok: res.status >= 200 && res.status < 400,
            status: res.status,
            status_text: res.statusText,
            latency_ms: res.timings.totalDurationMs,
            is_json: res.isJson,
            body: res.isJson ? res.jsonValue : res.body.slice(0, 4000),
          };
        } catch (err) {
          return {
            ok: false,
            error: String(err),
          };
        }
      },
    }),

    api_dispatch_webhook: tool({
      description:
        "Dispatch a mock signed webhook (Stripe, GitHub, Supabase, Resend) or trigger an idempotency test (burst duplicates) against a local or remote webhook endpoint. Verifies if the user's backend handles webhooks correctly without errors or double-charging.",
      inputSchema: z.object({
        target_url: z
          .string()
          .describe(
            "Local webhook endpoint URL (e.g. 'http://localhost:3000/api/webhooks/stripe')",
          ),
        service: z
          .enum(["stripe", "github", "supabase", "resend", "custom"])
          .describe("Webhook provider to emulate"),
        event_type: z
          .string()
          .describe(
            "Event type (e.g. 'payment_intent.succeeded', 'push', 'user.created')",
          ),
        payload: z
          .record(z.string(), z.unknown())
          .describe("JSON payload for the webhook event"),
        secret: z
          .string()
          .optional()
          .describe(
            "Optional signing secret for calculating Stripe-Signature or X-Hub-Signature-256 HMAC",
          ),
        duplicate_count: z
          .number()
          .optional()
          .describe(
            "Number of identical duplicate deliveries to fire (e.g. 3 for idempotency testing)",
          ),
      }),
      execute: async ({
        target_url,
        service,
        event_type,
        payload,
        secret,
        duplicate_count,
      }) => {
        try {
          const res = await dispatchMockWebhook({
            targetUrl: target_url,
            service,
            eventType: event_type,
            payload,
            secret,
            duplicateCount: duplicate_count ?? 1,
            delayMsBetweenDuplicates: 40,
          });

          return {
            ok: res.isIdempotent,
            target_url: res.targetUrl,
            service: res.service,
            event_type: res.eventType,
            is_idempotent: res.isIdempotent,
            summary: res.summary,
            attempts: res.attempts,
          };
        } catch (err) {
          return {
            ok: false,
            error: String(err),
          };
        }
      },
    }),
  };
}
