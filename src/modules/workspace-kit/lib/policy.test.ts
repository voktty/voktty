import { describe, expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/memory-use.json";
import { evaluateMemoryUse } from "@/modules/workspace-kit/lib/policy";

describe("memory use contract", () => {
  it.each(corpus.cases)("$name", (test) => {
    const input = JSON.stringify({ ...corpus.baseline, ...test.changes });
    if (test.invalid || test.error) {
      expect(() => evaluateMemoryUse(input)).toThrow();
      if (test.error) {
        expect(() => evaluateMemoryUse(input)).toThrow(test.error);
      }
      return;
    }
    expect(evaluateMemoryUse(input)).toEqual({
      schema: 1,
      policy: test.policy,
      reason: test.reason,
      contextAllowed: test.context,
      captureAllowed: test.capture,
    });
  });

  it("rejects oversized and invalid Unicode documents without exposing content", () => {
    expect(() => evaluateMemoryUse(" ".repeat(16385))).toThrow(
      "KIT_DOCUMENT_TOO_LARGE",
    );
    const input = JSON.stringify(corpus.baseline).replace(
      "session-1",
      "\\ud800",
    );
    expect(() => evaluateMemoryUse(input)).toThrow(
      "KIT_DOCUMENT_INVALID_UNICODE",
    );
  });

  it("returns a frozen decision and does not mutate the caller's data", () => {
    const input = JSON.stringify(corpus.baseline);
    const decision = evaluateMemoryUse(input);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(JSON.stringify(corpus.baseline)).toBe(input);
  });

  it("measures UTF-8 bytes and accepts the exact document size limit", () => {
    const input = JSON.stringify(corpus.baseline);
    expect(evaluateMemoryUse(input.padEnd(16384)).contextAllowed).toBe(true);
    const unicode = JSON.stringify({
      ...corpus.baseline,
      extra: "é".repeat(8192),
    });
    expect(unicode.length).toBeLessThan(16384);
    expect(() => evaluateMemoryUse(unicode)).toThrow("KIT_DOCUMENT_TOO_LARGE");
  });
});
