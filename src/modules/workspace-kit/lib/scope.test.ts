import { describe, expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/memory-scope.json";
import { resolveMemoryScope } from "@/modules/workspace-kit/lib/scope";

function change(
  input: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
) {
  let parent = input;
  for (const key of path.slice(0, -1))
    parent = parent[key] as Record<string, unknown>;
  parent[path[path.length - 1]] = value;
}

describe("project memory scope", () => {
  it.each(corpus.cases)("$name", (test) => {
    const facts = JSON.parse(JSON.stringify(corpus.baseline)) as Record<
      string,
      unknown
    >;
    for (const entry of test.changes) change(facts, entry.path, entry.value);
    const input = JSON.stringify(facts);
    if (test.invalid || test.error) {
      expect(() => resolveMemoryScope(input)).toThrow();
      if (test.error)
        expect(() => resolveMemoryScope(input)).toThrow(test.error);
    } else {
      expect(resolveMemoryScope(input)).toEqual({
        ...corpus.expected,
        ...test.expected,
      });
    }
  });

  it("bounds the ancestor chain without accepting a truncated proof of absence", () => {
    const ancestors = Array.from({ length: 128 }, (_, index) => ({
      directoryKey: index.toString(16).padStart(64, "0"),
      parentKey:
        index === 127 ? null : (index + 1).toString(16).padStart(64, "0"),
      state: "absent",
    }));
    const facts = { ...corpus.baseline, ancestors };
    expect(resolveMemoryScope(JSON.stringify(facts)).ancestryComplete).toBe(
      true,
    );
    expect(
      resolveMemoryScope(JSON.stringify({ ...facts, stop: "depth" })).state,
    ).toBe("incomplete");
    expect(() =>
      resolveMemoryScope(
        JSON.stringify({ ...facts, ancestors: [...ancestors, ancestors[0]] }),
      ),
    ).toThrow();
  });

  it("freezes all returned arrays and rejects oversized or invalid scalar input", () => {
    const result = resolveMemoryScope(JSON.stringify(corpus.baseline));
    expect(
      [
        result,
        result.ancestorKits,
        result.descendantKits,
        result.blockedKeys,
      ].every(Object.isFrozen),
    ).toBe(true);
    expect(() => resolveMemoryScope(" ".repeat(262145))).toThrow(
      "KIT_DOCUMENT_TOO_LARGE",
    );
    expect(() => resolveMemoryScope('{"extra":"\\ud800"}')).toThrow(
      "KIT_DOCUMENT_INVALID_UNICODE",
    );
  });
});
