import { describe, expect, it } from "vitest";
import { PtyTextDecoder } from "./ptyText";

const encode = (text: string) => new TextEncoder().encode(text);

function splitAt(bytes: Uint8Array, index: number): [Uint8Array, Uint8Array] {
  return [bytes.subarray(0, index), bytes.subarray(index)];
}

describe("PtyTextDecoder", () => {
  it("decodes a chunk that ends on a character boundary", () => {
    const decoder = new PtyTextDecoder();
    expect(decoder.decode(encode("ready\r\n"))).toBe("ready\r\n");
  });

  it("joins a multi-byte character split across two chunks", () => {
    const text = "Compilando modulo 45% listo";
    const withAccent = text.replace("modulo", "módulo");
    const bytes = encode(withAccent);
    // Cut inside the two-byte encoding of "ó".
    const cut = encode(withAccent.slice(0, withAccent.indexOf("ó") + 1)).length;
    const [head, tail] = splitAt(bytes, cut - 1);

    const decoder = new PtyTextDecoder();
    const joined = decoder.decode(head) + decoder.decode(tail);

    expect(joined).toBe(withAccent);
    expect(joined).not.toContain("�");
  });

  it("joins a four-byte character split across three chunks", () => {
    const bytes = encode("progress 100% 🎉 done");
    const decoder = new PtyTextDecoder();
    let out = "";
    // One byte at a time is the worst case a slow pipe can produce.
    for (const byte of bytes) out += decoder.decode(new Uint8Array([byte]));
    expect(out).toBe("progress 100% 🎉 done");
    expect(out).not.toContain("�");
  });

  it("keeps sessions independent", () => {
    const text = "café";
    const bytes = encode(text);
    const [head, tail] = splitAt(bytes, bytes.length - 1);

    const a = new PtyTextDecoder();
    const b = new PtyTextDecoder();
    // b interleaves between a's two halves and must not consume a's pending
    // byte, nor leak its own state into a.
    const first = a.decode(head);
    expect(b.decode(encode("other terminal\n"))).toBe("other terminal\n");
    expect(first + a.decode(tail)).toBe(text);
  });

  it("drops a truncated sequence on reset", () => {
    const bytes = encode("ñ");
    const decoder = new PtyTextDecoder();
    decoder.decode(bytes.subarray(0, 1));
    decoder.reset();
    expect(decoder.decode(encode("fresh"))).toBe("fresh");
  });

  it("does not fabricate a character across a skipped gap", () => {
    // deliverPtyBytes stops decoding when nothing reads the text. Without the
    // reset it performs then, the byte held mid-character here would join the
    // next decoded chunk and invent a character the shell never sent.
    const decoder = new PtyTextDecoder();
    decoder.decode(encode("ñ").subarray(0, 1));
    decoder.reset();
    const resumed = decoder.decode(encode("Building 42%"));
    expect(resumed).toBe("Building 42%");
    expect(resumed).not.toContain("�");
  });
});
