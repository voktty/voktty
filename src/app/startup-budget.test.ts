import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyzeStartupEntry,
  checkStartupBudget,
} from "../../scripts/startup-budget.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const fixtures = path.join(root, "scripts/fixtures/startup-budget");

describe("generated startup budget", () => {
  it("counts HTML startup assets once across stylesheet, preload, and script tags", () => {
    const result = analyzeStartupEntry(fixtures, { html: "index.html" });

    expect(result.resources.map((resource) => resource.path)).toEqual([
      "assets/app.css",
      "assets/main.js",
      "assets/heavy.js",
    ]);
    expect(result.rawBytes).toBeGreaterThan(0);
    expect(result.gzipBytes).toBeGreaterThan(0);
  });

  it("fails when a lazy asset is added to modulepreload", () => {
    expect(() =>
      checkStartupBudget(
        {
          entries: [
            {
              html: "index.html",
              maxResources: 3,
              forbiddenAssets: ["heavy.js"],
            },
          ],
        },
        fixtures,
      ),
    ).toThrow(/forbidden startup asset heavy\.js/);
  });

  it("fails when generated startup references exceed the resource budget", () => {
    expect(() =>
      checkStartupBudget(
        {
          entries: [{ html: "index.html", maxResources: 2 }],
        },
        fixtures,
      ),
    ).toThrow(/index\.html: 3 resources exceeds 2/);
  });

  it("fails when generated HTML references an absent asset", () => {
    expect(() =>
      analyzeStartupEntry(fixtures, { html: "missing.html" }),
    ).toThrow(/Startup asset does not exist: assets\/missing\.js/);
  });
});
