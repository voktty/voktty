const PROTOCOL_VERSION = 1;
const KEY_CONTEXT = "voktty-companion-transport-v1";

export type EncryptedFrame = {
  protocol: number;
  direction: "client_to_host" | "host_to_client";
  counter: number;
  ciphertext: string;
};

type SessionControl = {
  type: "key_confirm" | "key_confirmed";
  protocol: number;
};

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function encodeBase64Url(value: ArrayBuffer): string {
  let text = "";
  for (const byte of new Uint8Array(value)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function lengthPrefix(value: Uint8Array): Uint8Array {
  const prefix = new Uint8Array(8);
  new DataView(prefix.buffer).setBigUint64(0, BigInt(value.length));
  return prefix;
}

function fieldsPayload(fields: Uint8Array[]): ArrayBuffer {
  const payload = new Uint8Array(
    fields.reduce((total, field) => total + 8 + field.length, 0),
  );
  let offset = 0;
  for (const field of fields) {
    payload.set(lengthPrefix(field), offset);
    offset += 8;
    payload.set(field, offset);
    offset += field.length;
  }
  return payload.buffer as ArrayBuffer;
}

async function deriveDirectionKey(
  sharedSecret: ArrayBuffer,
  sessionId: string,
  direction: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    material,
    fieldsPayload([
      encoder.encode(KEY_CONTEXT),
      encoder.encode(sessionId),
      encoder.encode(direction),
    ]),
  );
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function header(direction: EncryptedFrame["direction"], counter: number): Uint8Array {
  const bytes = new Uint8Array(14);
  bytes.set(new TextEncoder().encode("VKCP"));
  bytes[4] = 1;
  bytes[5] = direction === "client_to_host" ? 1 : 2;
  new DataView(bytes.buffer).setBigUint64(6, BigInt(counter));
  return bytes;
}

function nonce(direction: EncryptedFrame["direction"], counter: number): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode(direction === "client_to_host" ? "VKC1" : "VKS1"));
  new DataView(bytes.buffer).setBigUint64(4, BigInt(counter));
  return bytes;
}

export class CompanionTransport {
  private sendCounter = 0;
  private receiveCounter = 0;

  private constructor(
    private readonly sendKey: CryptoKey,
    private readonly receiveKey: CryptoKey,
  ) {}

  static async forAndroid(sharedSecret: ArrayBuffer, sessionId: string) {
    const [sendKey, receiveKey] = await Promise.all([
      deriveDirectionKey(sharedSecret, sessionId, "client-to-host"),
      deriveDirectionKey(sharedSecret, sessionId, "host-to-client"),
    ]);
    return new CompanionTransport(sendKey, receiveKey);
  }

  async confirm(): Promise<EncryptedFrame> {
    const counter = this.sendCounter + 1;
    if (!Number.isSafeInteger(counter)) throw new Error("counter-exhausted");
    const direction = "client_to_host" as const;
    const aad = header(direction, counter);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ type: "key_confirm", protocol: PROTOCOL_VERSION } satisfies SessionControl),
    );
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce(direction, counter).buffer as ArrayBuffer,
        additionalData: aad.buffer as ArrayBuffer,
      },
      this.sendKey,
      plaintext,
    );
    this.sendCounter = counter;
    return {
      protocol: PROTOCOL_VERSION,
      direction,
      counter,
      ciphertext: encodeBase64Url(ciphertext),
    };
  }

  async acceptConfirmation(frame: EncryptedFrame): Promise<void> {
    const expected = this.receiveCounter + 1;
    if (
      frame.protocol !== PROTOCOL_VERSION ||
      frame.direction !== "host_to_client" ||
      frame.counter !== expected ||
      !Number.isSafeInteger(frame.counter)
    ) {
      throw new Error("invalid-session-frame");
    }
    const aad = header(frame.direction, frame.counter);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce(frame.direction, frame.counter).buffer as ArrayBuffer,
          additionalData: aad.buffer as ArrayBuffer,
        },
        this.receiveKey,
        decodeBase64Url(frame.ciphertext).buffer as ArrayBuffer,
      );
    } catch {
      throw new Error("invalid-session-frame");
    }
    const control = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<SessionControl>;
    if (control.type !== "key_confirmed" || control.protocol !== PROTOCOL_VERSION) {
      throw new Error("invalid-session-frame");
    }
    this.receiveCounter = frame.counter;
  }
}
