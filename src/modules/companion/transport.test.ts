import { describe, expect, it } from "vitest";
import {
  CompanionTransport,
  decodeBase64Url,
  encodeBase64Url,
  type ClientMessage,
} from "./transport";

describe("CompanionTransport", () => {
  it("encodes and decodes base64url correctly", () => {
    const data = new Uint8Array([1, 2, 3, 250, 255]);
    const encoded = encodeBase64Url(data.buffer);
    const decoded = decodeBase64Url(encoded);
    expect(Array.from(decoded)).toEqual([1, 2, 3, 250, 255]);
  });

  it("seals and opens confirmation between two endpoints", async () => {
    const secret = new Uint8Array(32).fill(7).buffer;
    const client = await CompanionTransport.forAndroid(secret, "session-1");
    // Client can seal confirmation
    const frame = await client.confirm();
    expect(frame.protocol).toBe(1);
    expect(frame.direction).toBe("client_to_host");
    expect(frame.counter).toBe(1);
    expect(frame.ciphertext.length).toBeGreaterThan(0);
  });

  it("seals client messages with proper sequence counters", async () => {
    const secret = new Uint8Array(32).fill(42).buffer;
    const client = await CompanionTransport.forAndroid(secret, "session-2");

    const message: ClientMessage = {
      type: "agent_message",
      protocol: 1,
      agentId: "agent-1",
      message: "Hello world",
    };

    const frame = await client.sealClientMessage(message);
    expect(frame.protocol).toBe(1);
    expect(frame.direction).toBe("client_to_host");
    expect(frame.counter).toBe(1);

    const ping: ClientMessage = {
      type: "ping",
      protocol: 1,
    };
    const frame2 = await client.sealClientMessage(ping);
    expect(frame2.counter).toBe(2);
  });

  it("rejects invalid server message frames", async () => {
    const secret = new Uint8Array(32).fill(42).buffer;
    const client = await CompanionTransport.forAndroid(secret, "session-3");

    await expect(
      client.openServerMessage({
        protocol: 99,
        direction: "host_to_client",
        counter: 1,
        ciphertext: "abc",
      }),
    ).rejects.toThrow("invalid-session-frame");
  });
});
