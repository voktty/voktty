import { describe, expect, it } from "vitest";
import { parseTestResults } from "./testResults";

describe("parseTestResults", () => {
  it("normalizes Vitest and Rust result lines", () => {
    const results = parseTestResults([
      " ✓ src/math.test.ts > adds values 4ms",
      " × src/math.test.ts > rejects NaN 2ms",
      "test parser::accepts_header ... ok",
      "test parser::rejects_large_frame ... FAILED",
    ].join("\n"));

    expect(results.map((result) => result.status)).toEqual([
      "passed",
      "failed",
      "passed",
      "failed",
    ]);
    expect(results[0]?.file).toBe("src/math.test.ts");
    expect(results[3]?.name).toBe("parser::rejects_large_frame");
  });

  it("caps output-derived results and removes terminal escapes", () => {
    const output = Array.from(
      { length: 2_500 },
      (_, index) => `\u001b[32m✓ file.test.ts > case ${index}\u001b[0m`,
    ).join("\n");
    const results = parseTestResults(output);
    expect(results).toHaveLength(2_000);
    expect(results[0]?.name).toBe("case 0");
  });
});
