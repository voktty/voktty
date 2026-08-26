import { credentialsFromGuestForm } from "@/modules/collab/lib/invite";
import { describe, expect, it } from "vitest";

describe("credentialsFromGuestForm", () => {
  it("normalizes a public invitation and derives its session id", () => {
    expect(
      credentialsFromGuestForm({
        connectionUrl:
          "  wss://quiet-river.trycloudflare.com/v1/session/session-42  ",
        inviteCode: "  secret-code  ",
        participantName: "  Ada  ",
      }),
    ).toEqual({
      connectionUrl:
        "wss://quiet-river.trycloudflare.com/v1/session/session-42",
      sessionId: "session-42",
      inviteCode: "secret-code",
      participantName: "Ada",
    });
  });

  it("rejects invitations that do not use secure WebSockets", () => {
    expect(() =>
      credentialsFromGuestForm({
        connectionUrl: "ws://public.example/v1/session/session-42",
        inviteCode: "secret-code",
        participantName: "Ada",
      }),
    ).toThrow("secure_url_required");
  });

  it("accepts loopback WebSockets for local development", () => {
    expect(
      credentialsFromGuestForm({
        connectionUrl: "ws://127.0.0.1:4040/v1/session/local-session",
        inviteCode: "secret-code",
        participantName: "Ada",
      }).sessionId,
    ).toBe("local-session");
  });

  it("requires every invitation field", () => {
    expect(() =>
      credentialsFromGuestForm({
        connectionUrl: "wss://example.com/v1/session/session-42",
        inviteCode: "",
        participantName: "Ada",
      }),
    ).toThrow("invite_code_required");
  });
});
