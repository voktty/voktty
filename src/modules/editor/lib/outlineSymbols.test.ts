import { describe, expect, it } from "vitest";
import { extractDocumentSymbols, filterSymbols } from "./outlineSymbols";

describe("fallback document symbols", () => {
  it("extracts TypeScript containers and members", () => {
    const symbols = extractDocumentSymbols(
      [
        "export class Greeter {",
        "  constructor(private name: string) {}",
        "  async greet() {",
        "    return this.name;",
        "  }",
        "}",
        "export function run() {}",
      ].join("\n"),
      "typescript",
      "src/greeter.ts",
    );

    expect(symbols.map((symbol) => symbol.name)).toEqual(["Greeter", "run"]);
    expect(symbols[0].children.map((symbol) => symbol.name)).toEqual([
      "constructor",
      "greet",
    ]);
    expect(symbols[0].line).toBe(1);
    expect(symbols[0].children[1].line).toBe(3);
  });

  it("builds a Markdown heading hierarchy", () => {
    const symbols = extractDocumentSymbols(
      "# Project\n## Install\n### Windows\n## Usage",
      "markdown",
      "README.md",
    );

    expect(symbols).toMatchObject([
      {
        name: "Project",
        children: [
          { name: "Install", children: [{ name: "Windows" }] },
          { name: "Usage" },
        ],
      },
    ]);
  });

  it("filters descendants while retaining their parent context", () => {
    const symbols = extractDocumentSymbols(
      "class Runner {\n  start() {}\n  stop() {}\n}",
      "javascript",
      "runner.js",
    );

    expect(filterSymbols(symbols, "stop")).toMatchObject([
      { name: "Runner", children: [{ name: "stop" }] },
    ]);
  });

  it("extracts PHP classes, methods, and top-level functions", () => {
    const symbols = extractDocumentSymbols(
      [
        "class UserRepository {",
        "    public function save(array $user): void {}",
        "}",
        "function boot(): void {}",
      ].join("\n"),
      "php",
      "src/UserRepository.php",
    );

    expect(symbols.map((symbol) => symbol.name)).toEqual([
      "UserRepository",
      "boot",
    ]);
    expect(symbols[0].children.map((symbol) => symbol.name)).toEqual(["save"]);
  });
});
