import type { ApiScenario } from "../types";

export type WebhookPreset = {
  id: string;
  name: string;
  service: string;
  description: string;
  eventType: string;
  defaultSecret: string;
  payload: Record<string, unknown>;
};

export const WEBHOOK_PRESETS: WebhookPreset[] = [
  {
    id: "stripe-payment-intent-succeeded",
    name: "Stripe: Payment Intent Succeeded",
    service: "stripe",
    description: "Emulates a successful checkout payment intent with charge ID and customer metadata.",
    eventType: "payment_intent.succeeded",
    defaultSecret: "whsec_test_secret_key_12345",
    payload: {
      id: "evt_3MtwxZ2eZvKYlo2C0VvsmQqq",
      object: "event",
      api_version: "2024-06-20",
      created: 1716900000,
      data: {
        object: {
          id: "pi_3MtwxZ2eZvKYlo2C0VvsmQqq",
          object: "payment_intent",
          amount: 4900,
          amount_received: 4900,
          currency: "usd",
          status: "succeeded",
          customer: "cus_N5dKqL8eZq71k9",
          client_secret: "pi_3MtwxZ2eZvKYlo2C0VvsmQqq_secret_abc123",
          payment_method: "pm_1MtwxZ2eZvKYlo2CqQvsmQqq",
          metadata: {
            order_id: "ord_994821",
            user_id: "usr_voktty_01",
          },
        },
      },
      type: "payment_intent.succeeded",
    },
  },
  {
    id: "stripe-charge-failed",
    name: "Stripe: Charge Failed (Card Declined)",
    service: "stripe",
    description: "Emulates a failed payment charge with insufficient funds / card declined error code.",
    eventType: "charge.failed",
    defaultSecret: "whsec_test_secret_key_12345",
    payload: {
      id: "evt_3MtwxZ2eZvKYlo2C0FailCharge",
      object: "event",
      api_version: "2024-06-20",
      created: 1716900000,
      data: {
        object: {
          id: "ch_3MtwxZ2eZvKYlo2C0FailCharge",
          object: "charge",
          amount: 4900,
          currency: "usd",
          paid: false,
          status: "failed",
          failure_code: "card_declined",
          failure_message: "Your card has insufficient funds.",
          outcome: {
            network_status: "declined_by_network",
            reason: "insufficient_funds",
            risk_level: "normal",
            seller_message: "The bank returned the decline code `insufficient_funds`.",
          },
        },
      },
      type: "charge.failed",
    },
  },
  {
    id: "stripe-charge-refunded",
    name: "Stripe: Charge Refunded",
    service: "stripe",
    description: "Emulates a full refund webhook for inventory clawback and access revocation.",
    eventType: "charge.refunded",
    defaultSecret: "whsec_test_secret_key_12345",
    payload: {
      id: "evt_3MtwxZ2eZvKYlo2C0RefundCharge",
      object: "event",
      api_version: "2024-06-20",
      created: 1716900000,
      data: {
        object: {
          id: "ch_3MtwxZ2eZvKYlo2C0RefundCharge",
          object: "charge",
          amount: 4900,
          amount_refunded: 4900,
          currency: "usd",
          refunded: true,
          refunds: {
            total_count: 1,
            data: [
              {
                id: "re_3MtwxZ2eZvKYlo2C0RefundId",
                amount: 4900,
                currency: "usd",
                reason: "requested_by_customer",
                status: "succeeded",
              },
            ],
          },
        },
      },
      type: "charge.refunded",
    },
  },
  {
    id: "github-push",
    name: "GitHub: Push Event",
    service: "github",
    description: "Emulates a git push event to main branch with commit list and sender info.",
    eventType: "push",
    defaultSecret: "gh_webhook_secret_xyz789",
    payload: {
      ref: "refs/heads/main",
      before: "6113728f27ae82c7b1a12f6593b1ef4086e0242b",
      after: "87c716180dfd3221ebc839f99e3cb1277d33d67f",
      repository: {
        id: 8839201,
        name: "voktty-app",
        full_name: "voktty/voktty-app",
        private: true,
      },
      pusher: {
        name: "developer",
        email: "dev@voktty.internal",
      },
      commits: [
        {
          id: "87c716180dfd3221ebc839f99e3cb1277d33d67f",
          message: "feat: add api client diagnostics",
          timestamp: "2026-08-27T09:00:00Z",
          added: ["src/modules/api-client/index.ts"],
          modified: ["package.json"],
          removed: [],
        },
      ],
    },
  },
  {
    id: "supabase-user-created",
    name: "Supabase: Auth User Created",
    service: "supabase",
    description: "Emulates a new user registration webhook event from Supabase Auth.",
    eventType: "user.created",
    defaultSecret: "sb_webhook_secret_998877",
    payload: {
      type: "INSERT",
      table: "users",
      schema: "auth",
      record: {
        id: "d9e84712-4210-4f91-8891-b1e967a21390",
        email: "alice@example.com",
        role: "authenticated",
        created_at: "2026-08-27T09:15:00.000Z",
        app_metadata: {
          provider: "email",
          providers: ["email"],
        },
        user_metadata: {
          full_name: "Alice Developer",
        },
      },
    },
  },
  {
    id: "resend-email-delivered",
    name: "Resend: Email Delivered",
    service: "resend",
    description: "Emulates transactional email delivery event confirmation.",
    eventType: "email.delivered",
    defaultSecret: "resend_whsec_554433",
    payload: {
      type: "email.delivered",
      created_at: "2026-08-27T09:20:00.000Z",
      data: {
        created_at: "2026-08-27T09:19:55.000Z",
        email_id: "re_4mN8qZ2eZvKYlo2C",
        from: "notifications@voktty.internal",
        to: ["customer@company.com"],
        subject: "Your invoice #994821 is ready",
      },
    },
  },
];

export const PRESET_SCENARIOS: ApiScenario[] = [
  {
    id: "scenario-stripe-full-cycle",
    name: "Stripe Full Checkout & Idempotency",
    service: "stripe",
    description: "Runs an end-to-end payment webhook test followed by an Idempotency duplicate probe.",
    steps: [
      {
        id: "step-1",
        name: "1. Dispatch payment_intent.succeeded",
        kind: "webhook",
        webhook: {
          targetUrl: "http://localhost:3000/api/webhooks/stripe",
          service: "stripe",
          eventType: "payment_intent.succeeded",
          secret: "whsec_test_secret_key_12345",
          duplicateCount: 1,
          payload: WEBHOOK_PRESETS[0].payload,
        },
        assertions: [],
      },
      {
        id: "step-2",
        name: "2. Idempotency Probe (3x Duplicate Burst)",
        kind: "webhook",
        webhook: {
          targetUrl: "http://localhost:3000/api/webhooks/stripe",
          service: "stripe",
          eventType: "payment_intent.succeeded",
          secret: "whsec_test_secret_key_12345",
          duplicateCount: 3,
          delayMsBetweenDuplicates: 20,
          payload: WEBHOOK_PRESETS[0].payload,
        },
        assertions: [],
      },
    ],
  },
];
