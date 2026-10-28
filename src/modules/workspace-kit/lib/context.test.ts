import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/memory-context.json";
import {
  buildMemoryContext,
  instructionFingerprint,
} from "@/modules/workspace-kit/lib/context";
import { memoryProjectKey } from "@/modules/workspace-kit/lib/identity";

type Mutation = {
  path: readonly (string | number)[];
  value?: unknown;
  repeat?: { text: string; count: number };
  prefix?: string;
  remove?: boolean;
};
function change(input: Record<string, unknown>, entry: Mutation) {
  let parent = input;
  for (const key of entry.path.slice(0, -1))
    parent = parent[key] as Record<string, unknown>;
  const key = entry.path[entry.path.length - 1];
  if (entry.remove) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else
    parent[key] = entry.repeat
      ? (entry.prefix ?? "") + entry.repeat.text.repeat(entry.repeat.count)
      : entry.value;
}
function fixture(source: unknown, changes: readonly Mutation[]) {
  const input = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  for (const entry of changes) change(input, entry);
  return input;
}

describe("instruction fingerprint", () => {
  it.each(corpus.fingerprintCases)("$name", async (test) => {
    const input = fixture(corpus.baseline.instructions, test.changes);
    const run = () => instructionFingerprint(JSON.stringify(input));
    if (test.invalid || test.error) {
      await expect(run()).rejects.toThrow(test.error);
      return;
    }
    const result = await run();
    expect(result.digest).toBe(test.digest);
    if (!test.changes.length) expect(result).toEqual(corpus.fingerprint);
    expect(Object.isFrozen(result.files)).toBe(true);
    const files = input.files as {
      path: string;
      fact: { kind: string; text?: string };
    }[];
    expect(result.files).toEqual(
      [...files]
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map(({ path, fact }) => ({
          path,
          kind: fact.kind,
          sha256:
            fact.kind === "file"
              ? createHash("sha256")
                  .update(fact.text ?? "")
                  .digest("hex")
              : null,
        })),
    );
  });

  it("waits for all admitted hashes before propagating a failure", async () => {
    const callbacks: {
      resolve: (bytes: ArrayBuffer) => void;
      reject: (error: Error) => void;
    }[] = [];
    const digest = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(
        () =>
          new Promise<ArrayBuffer>((resolve, reject) =>
            callbacks.push({ resolve, reject }),
          ),
      );
    let settled = false;
    const failure = new Error("fixture digest failure");
    const pending = instructionFingerprint(
      JSON.stringify(corpus.baseline.instructions),
    ).finally(() => {
      settled = true;
    });
    const observed = expect(pending).rejects.toBe(failure);
    try {
      expect(callbacks.length).toBeGreaterThan(1);
      callbacks[0].reject(failure);
      await Promise.resolve();
      expect(settled).toBe(false);
      for (const callback of callbacks.slice(1))
        callback.resolve(new ArrayBuffer(32));
      await observed;
    } finally {
      for (const callback of callbacks) callback.resolve(new ArrayBuffer(32));
      digest.mockRestore();
    }
  });
});

describe("bounded memory context", () => {
  it.each(corpus.packetCases)("$name", async (test) => {
    const input = fixture(corpus.baseline, test.changes);
    if (test.acceptedDigest) {
      change(input, {
        path: ["use", "instructionDigest"],
        value: test.acceptedDigest,
      });
      change(input, {
        path: ["use", "trust", "instructionDigest"],
        value: test.acceptedDigest,
      });
    }
    const run = () => buildMemoryContext(JSON.stringify(input));
    if (test.invalid || test.error) {
      await expect(run()).rejects.toThrow(test.error);
      return;
    }
    const result = await run();
    expect(result.decision).toEqual(test.decision);
    if (!test.packet) {
      expect(result.packet).toBeNull();
      return;
    }
    const packet = result.packet;
    if (!packet) throw new Error("Missing context fixture packet");
    const { text, ...metadata } = packet;
    expect(metadata).toEqual(test.packet);
    expect(Buffer.byteLength(text, "utf8")).toBe(metadata.bytes);
    expect(metadata.bytes).toBeLessThanOrEqual(24576);
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      metadata.digest,
    );
    if (test.text) expect(text).toBe(test.text);
    const body = JSON.parse(text.slice(text.indexOf("\n{") + 1));
    expect(
      body.sections.map((section: { mode: string }) => section.mode),
    ).toEqual(test.modes);
  });

  it("accounts for extreme metadata and reaches the exact packet ceiling", async () => {
    const input = structuredClone(corpus.baseline);
    input.identity.canonicalRoot = `/${'"'.repeat(4095)}`;
    const key = await memoryProjectKey(JSON.stringify(input.identity));
    input.use.projectKey =
      input.use.trust.projectKey =
      input.use.session.projectKey =
        key;
    input.config.project = input.config.values.project_name = '"'.repeat(512);
    const init = input.instructions.files.find(
      (entry) => entry.path === ".voktty/INIT.md",
    );
    if (!init) throw new Error("Missing INIT fixture");
    init.fact = { kind: "file", text: "i".repeat(12000) };
    input.project.text = "p".repeat(10000);
    input.context.text = "c".repeat(10000);
    const accepted = await instructionFingerprint(
      JSON.stringify(input.instructions),
    );
    input.use.instructionDigest = input.use.trust.instructionDigest =
      accepted.digest;
    const result = await buildMemoryContext(JSON.stringify(input));
    const packet = result.packet;
    if (!packet) throw new Error("Missing bounded fixture packet");
    expect(packet.bytes).toBe(24576);
    expect(Buffer.byteLength(packet.text)).toBe(24576);
    expect(
      JSON.parse(packet.text.slice(packet.text.indexOf("\n{") + 1)).sections,
    ).toHaveLength(3);
  });

  it("does not hash or construct context when session use is disabled", async () => {
    const input = structuredClone(corpus.baseline);
    input.use.session.context = "disabled";
    const digest = vi.spyOn(crypto.subtle, "digest");
    try {
      expect(
        (await buildMemoryContext(JSON.stringify(input))).packet,
      ).toBeNull();
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it("keeps distinct document limits, scalar validation and the node guard", async () => {
    await expect(
      instructionFingerprint(" ".repeat(2 * 1024 * 1024 + 1)),
    ).rejects.toThrow("KIT_DOCUMENT_TOO_LARGE");
    await expect(
      buildMemoryContext(" ".repeat(4 * 1024 * 1024 + 1)),
    ).rejects.toThrow("KIT_DOCUMENT_TOO_LARGE");
    await expect(instructionFingerprint('{"extra":"\\ud800"}')).rejects.toThrow(
      "KIT_DOCUMENT_INVALID_UNICODE",
    );
    await expect(
      instructionFingerprint(JSON.stringify({ extra: Array(16384).fill(0) })),
    ).rejects.toThrow("KIT_DOCUMENT_NODE_LIMIT");
  });
});
