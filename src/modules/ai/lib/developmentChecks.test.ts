import { describe, expect, it } from "vitest";
import { deriveDevelopmentChecks } from "./developmentChecks";

describe("deriveDevelopmentChecks", () => {
  it("maps package scripts to the detected package manager", () => {
    expect(
      deriveDevelopmentChecks({
        packageManager: "pnpm",
        scripts: {
          format: "biome format --write .",
          "check-types": "tsc --noEmit",
          test: "vitest run",
        },
        hasCargo: false,
      }),
    ).toEqual([
      { kind: "format", command: "pnpm format", source: "package.json" },
      { kind: "types", command: "pnpm check-types", source: "package.json" },
      { kind: "tests", command: "pnpm test", source: "package.json" },
    ]);
  });

  it("adds portable Cargo checks without replacing package checks", () => {
    expect(
      deriveDevelopmentChecks({
        packageManager: "npm",
        scripts: { test: "vitest run" },
        hasCargo: true,
      }),
    ).toEqual([
      { kind: "tests", command: "npm test", source: "package.json" },
      { kind: "format", command: "cargo fmt --check", source: "Cargo.toml" },
      {
        kind: "types",
        command: "cargo check --workspace --locked",
        source: "Cargo.toml",
      },
      {
        kind: "tests",
        command: "cargo test --workspace --locked",
        source: "Cargo.toml",
      },
    ]);
  });
});
