import { describe, expect, it } from "vitest";
import {
  foregroundHarnessSessionIds,
  type HarnessSessionViewReport,
  normalizeHarnessSessionViewReport,
  referencedHarnessSessionIds,
  sameHarnessSessionViewReport,
} from "@/modules/harness/lib/harnessSessionViews";

const report = normalizeHarnessSessionViewReport;

describe("normalizeHarnessSessionViewReport", () => {
  it("defaults to an empty immutable report", () => {
    const result = report({ referencedSessionIds: [] });
    expect(result).toEqual({
      referencedSessionIds: [],
      foregroundSessionIds: [],
      activeSessionId: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.referencedSessionIds)).toBe(true);
    expect(Object.isFrozen(result.foregroundSessionIds)).toBe(true);
  });

  it("copies, deduplicates and sorts without changing caller arrays", () => {
    const references = ["b", "a", "b"];
    const foreground = ["b", "b"];
    const result = report({
      referencedSessionIds: references,
      foregroundSessionIds: foreground,
      activeSessionId: "a",
    });
    expect(result).toEqual({
      referencedSessionIds: ["a", "b"],
      foregroundSessionIds: ["b"],
      activeSessionId: "a",
    });
    expect(references).toEqual(["b", "a", "b"]);
    expect(foreground).toEqual(["b", "b"]);
    expect(result.referencedSessionIds).not.toBe(references);
    expect(result.foregroundSessionIds).not.toBe(foreground);
    references.push("c");
    foreground.push("a");
    expect(result.referencedSessionIds).toEqual(["a", "b"]);
    expect(result.foregroundSessionIds).toEqual(["b"]);
    expect(() => (result.referencedSessionIds as string[]).push("c")).toThrow();
    expect(() => (result.foregroundSessionIds as string[]).push("a")).toThrow();
    expect(() => {
      (result as { activeSessionId: string | null }).activeSessionId = "b";
    }).toThrow();
  });

  it("preserves opaque case, whitespace and special object keys exactly", () => {
    const ids = [
      "constructor",
      "__proto__",
      "toString",
      "A",
      "a",
      " a ",
      "a/b\\c",
      "\u0000",
      "SafeRootPreset_Field",
    ];
    const result = report({
      referencedSessionIds: ids,
      foregroundSessionIds: ["__proto__"],
      activeSessionId: " a ",
    });
    expect(result.referencedSessionIds).toEqual([...ids].sort());
    expect(result.foregroundSessionIds).toEqual(["__proto__"]);
    expect(result.activeSessionId).toBe(" a ");
  });

  it("keeps references independent of active and foreground selection", () => {
    const base = { referencedSessionIds: ["local", "remote"] };
    const selected = report({
      ...base,
      foregroundSessionIds: ["local"],
      activeSessionId: "local",
    });
    const hidden = report({ ...base, activeSessionId: "remote" });
    expect(selected.referencedSessionIds).toEqual(hidden.referencedSessionIds);
    expect(hidden.foregroundSessionIds).toEqual([]);
  });

  it("accepts both inclusive default boundaries", () => {
    const ids = Array.from({ length: 256 }, (_, index) => `session-${index}`);
    ids[0] = "x".repeat(256);
    const result = report({
      referencedSessionIds: ids,
      foregroundSessionIds: ids,
      activeSessionId: ids[0],
    });
    expect(result.referencedSessionIds).toHaveLength(256);
    expect(result.foregroundSessionIds).toHaveLength(256);
    expect(result.activeSessionId).toHaveLength(256);
  });

  it.each(["referencedSessionIds", "foregroundSessionIds"] as const)(
    "rejects oversized raw %s before deduplication",
    (field) => {
      expect(() =>
        report({ referencedSessionIds: ["a"], [field]: Array(257).fill("a") }),
      ).toThrow(TypeError);
      expect(() =>
        report({ referencedSessionIds: ["a"], [field]: ["a", "a", "a"] }, 2),
      ).toThrow(TypeError);
    },
  );

  it("checks both raw bounds before inspecting or deduplicating IDs", () => {
    const references = ["a"];
    Object.defineProperty(references, 0, {
      get() {
        throw new Error("IDs must not be inspected");
      },
    });
    expect(() =>
      report({
        referencedSessionIds: references,
        foregroundSessionIds: Array(257).fill("a"),
      }),
    ).toThrow(TypeError);
    references.length = 257;
    expect(() => report({ referencedSessionIds: references })).toThrow(
      TypeError,
    );
  });

  it.each([null, undefined, "invalid", 42])(
    "rejects malformed report objects %#",
    (input) => {
      expect(() =>
        report(input as unknown as Parameters<typeof report>[0]),
      ).toThrow(TypeError);
    },
  );

  it("honors custom and zero reference limits", () => {
    expect(
      report(
        { referencedSessionIds: ["b", "a"], foregroundSessionIds: ["a", "b"] },
        2,
      ).referencedSessionIds,
    ).toEqual(["a", "b"]);
    expect(
      report({ referencedSessionIds: [] }, 0).referencedSessionIds,
    ).toEqual([]);
    expect(() => report({ referencedSessionIds: ["a"] }, 0)).toThrow(TypeError);
    expect(
      report({ referencedSessionIds: Array(257).fill("a") }, 257)
        .referencedSessionIds,
    ).toEqual(["a"]);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid numeric cap %s",
    (cap) => {
      expect(() => report({ referencedSessionIds: [] }, cap)).toThrow(
        RangeError,
      );
    },
  );

  it.each(["", " ", "\t\n", "x".repeat(257), 1, null, undefined, {}])(
    "rejects invalid reference ID %#",
    (id) => {
      expect(() => report({ referencedSessionIds: [id] as string[] })).toThrow(
        TypeError,
      );
    },
  );

  it.each(["", " ", "\t\n", "x".repeat(257), "unknown", 1, {}])(
    "rejects invalid foreground or active ID %#",
    (id) => {
      expect(() =>
        report({
          referencedSessionIds: ["a"],
          foregroundSessionIds: [id] as string[],
        }),
      ).toThrow(TypeError);
      expect(() =>
        report({ referencedSessionIds: ["a"], activeSessionId: id as string }),
      ).toThrow(TypeError);
    },
  );

  it.each([null, {}, "a", new Set(["a"])])(
    "rejects non-array reference and foreground inputs %#",
    (ids) => {
      expect(() => report({ referencedSessionIds: ids as string[] })).toThrow(
        TypeError,
      );
      expect(() =>
        report({
          referencedSessionIds: ["a"],
          foregroundSessionIds: ids as string[],
        }),
      ).toThrow(TypeError);
    },
  );

  it("rejects sparse arrays rather than silently dropping missing IDs", () => {
    expect(() =>
      report({ referencedSessionIds: new Array<string>(1) }),
    ).toThrow(TypeError);
    expect(() =>
      report({
        referencedSessionIds: ["a"],
        foregroundSessionIds: new Array<string>(1),
      }),
    ).toThrow(TypeError);
  });

  it("does not disclose invalid private content in errors", () => {
    const syntheticPrivateId = "synthetic-private-session".repeat(20);
    expect(() =>
      report({ referencedSessionIds: [syntheticPrivateId] }),
    ).toThrow("Invalid Harness session view report");
    try {
      report({ referencedSessionIds: [syntheticPrivateId] });
    } catch (error) {
      expect(String(error)).not.toContain(syntheticPrivateId);
    }
  });
});

describe("sameHarnessSessionViewReport", () => {
  const base: HarnessSessionViewReport = {
    referencedSessionIds: ["a", "b"],
    foregroundSessionIds: ["b"],
    activeSessionId: "a",
  };

  it("compares semantic membership rather than identity, order or duplicates", () => {
    expect(
      sameHarnessSessionViewReport(base, {
        ...base,
        referencedSessionIds: ["b", "a", "a"],
        foregroundSessionIds: ["b", "b"],
      }),
    ).toBe(true);
    expect(sameHarnessSessionViewReport(base, { ...base })).toBe(true);
    expect(
      sameHarnessSessionViewReport(
        report({ referencedSessionIds: [] }),
        report({ referencedSessionIds: [] }),
      ),
    ).toBe(true);
  });

  it.each([
    { referencedSessionIds: ["a", "c"] },
    { referencedSessionIds: ["a"] },
    { foregroundSessionIds: ["a"] },
    { foregroundSessionIds: [] },
    { activeSessionId: "b" },
    { activeSessionId: null },
  ])("detects semantic changes %#", (change) => {
    expect(sameHarnessSessionViewReport(base, { ...base, ...change })).toBe(
      false,
    );
  });
});

describe("Harness session report unions", () => {
  const first = report({
    referencedSessionIds: ["local", "shared"],
    foregroundSessionIds: ["local"],
    activeSessionId: "shared",
  });
  const second = report({
    referencedSessionIds: ["remote", "shared"],
    foregroundSessionIds: ["shared", "remote"],
    activeSessionId: "remote",
  });

  it("produces deterministic unique unions from arbitrary iterables", () => {
    expect(referencedHarnessSessionIds(new Set([second, first]))).toEqual([
      "local",
      "remote",
      "shared",
    ]);
    expect(foregroundHarnessSessionIds([second, first, second])).toEqual([
      "local",
      "remote",
      "shared",
    ]);
    expect(referencedHarnessSessionIds([first, second])).toEqual(
      referencedHarnessSessionIds([second, first]),
    );
    expect(foregroundHarnessSessionIds([first, second])).toEqual(
      foregroundHarnessSessionIds([second, first]),
    );
  });

  it("removing the first report keeps the second report's shared session", () => {
    expect(referencedHarnessSessionIds([second])).toEqual(["remote", "shared"]);
    expect(foregroundHarnessSessionIds([second])).toEqual(["remote", "shared"]);
    expect(second.activeSessionId).toBe("remote");
  });

  it("does not infer foreground from references or selection", () => {
    expect(foregroundHarnessSessionIds([first])).toEqual(["local"]);
    expect(referencedHarnessSessionIds([first])).toEqual(["local", "shared"]);
  });

  it("accepts one-shot generators and freezes empty and populated unions", () => {
    function* reports() {
      yield first;
      yield second;
    }
    const ids = referencedHarnessSessionIds(reports());
    expect(ids).toEqual(["local", "remote", "shared"]);
    expect(Object.isFrozen(ids)).toBe(true);
    expect(Object.isFrozen(foregroundHarnessSessionIds(reports()))).toBe(true);
    expect(referencedHarnessSessionIds([])).toEqual([]);
    expect(foregroundHarnessSessionIds([])).toEqual([]);
    expect(Object.isFrozen(referencedHarnessSessionIds([]))).toBe(true);
  });

  it("leaves the aggregate admission cap to the runtime owner", () => {
    const left = report({
      referencedSessionIds: Array.from({ length: 256 }, (_, i) => `left-${i}`),
    });
    const right = report({ referencedSessionIds: ["right"] });
    expect(referencedHarnessSessionIds([left, right])).toHaveLength(257);
  });
});
