import { describe, expect, it } from "vitest";
import { generateScenarioMarkdownReceipt, generateWebhookMarkdownReceipt } from "./markdownReceipt";
import type { ApiScenarioResult, ApiWebhookResult } from "../types";

describe("markdownReceipt", () => {
  it("generates markdown receipt for scenario results", () => {
    const scenario: ApiScenarioResult = {
      scenarioName: "Stripe End-to-End Checkout",
      service: "stripe",
      passed: true,
      totalSteps: 1,
      passedSteps: 1,
      failedSteps: 0,
      totalDurationMs: 45,
      timestamp: Date.now(),
      stepResults: [
        {
          stepId: "step-1",
          stepName: "Create Customer",
          stepKind: "request",
          passed: true,
          durationMs: 45,
          assertions: [
            {
              assertion: {
                property: "status",
                operator: "equals",
                expected: 200,
              },
              passed: true,
              actual: 200,
              message: "Expected HTTP status to equal 200",
            },
          ],
        },
      ],
    };

    const md = generateScenarioMarkdownReceipt(scenario);
    expect(md).toContain("# Integration Validation Receipt");
    expect(md).toContain("Stripe End-to-End Checkout");
    expect(md).toContain("PASSED (VERIFIED)");
    expect(md).toContain("Create Customer");
  });

  it("generates markdown receipt for webhook results", () => {
    const webhook: ApiWebhookResult = {
      service: "stripe",
      eventType: "payment_intent.succeeded",
      targetUrl: "http://localhost:3000/api/webhooks/stripe",
      attempts: [
        {
          attempt: 1,
          status: 200,
          durationMs: 18,
          responseBody: '{"received": true}',
          success: true,
        },
        {
          attempt: 2,
          status: 200,
          durationMs: 15,
          responseBody: '{"received": true}',
          success: true,
        },
      ],
      isIdempotent: true,
      summary: "Webhook processed successfully across 2 deliveries without double side-effects.",
    };

    const md = generateWebhookMarkdownReceipt(webhook);
    expect(md).toContain("# Webhook Validation Receipt");
    expect(md).toContain("stripe");
    expect(md).toContain("payment_intent.succeeded");
    expect(md).toContain("IDEMPOTENT (PASSED)");
  });
});
