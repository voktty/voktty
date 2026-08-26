import { describe, expect, it } from "vitest";
import { buildDevelopmentContext } from "./developmentContext";

describe("buildDevelopmentContext", () => {
  it("keeps only bounded, readable workspace data", () => {
    const result = buildDevelopmentContext({
      workspaceRoot: "/repo",
      activeFile: "/repo/src/app.ts",
      buffers: [
        {
          path: "/repo/src/app.ts",
          language: "typescript",
          dirty: true,
          cursor: { line: 4, column: 2 },
          excerpt: "a".repeat(12_000),
          symbols: Array.from({ length: 120 }, (_, i) => ({
            name: `symbol-${i}`,
            kind: "function",
            line: i + 1,
          })),
        },
        {
          path: "/repo/.env",
          language: "dotenv",
          dirty: false,
          cursor: { line: 1, column: 1 },
          excerpt: "SECRET=never",
          symbols: [],
        },
        {
          path: "/outside/file.ts",
          language: "typescript",
          dirty: false,
          cursor: { line: 1, column: 1 },
          excerpt: "outside",
          symbols: [],
        },
      ],
      diagnostics: Array.from({ length: 150 }, (_, i) => ({
        path: "/repo/src/app.ts",
        severity: "warning" as const,
        message: `diagnostic-${i}`,
        line: i + 1,
        column: 1,
      })),
      git: {
        branch: "main",
        changedFiles: Array.from({ length: 130 }, (_, i) => ({
          path: `src/file-${i}.ts`,
          status: "M",
        })),
      },
      terminal: "x".repeat(12_000),
      checks: Array.from({ length: 20 }, (_, i) => `pnpm test:${i}`),
    });

    expect(result.buffers).toHaveLength(1);
    expect(result.buffers[0]?.excerpt.length).toBeLessThanOrEqual(8_000);
    expect(result.buffers[0]?.symbols).toHaveLength(80);
    expect(result.diagnostics).toHaveLength(100);
    expect(result.git?.changedFiles).toHaveLength(100);
    expect(result.terminal?.length).toBeLessThanOrEqual(8_000);
    expect(result.checks).toHaveLength(12);
    expect(JSON.stringify(result)).not.toContain("SECRET=never");
    expect(result.truncated).toBe(true);
  });

  it("returns no project context without an explicit workspace root", () => {
    const result = buildDevelopmentContext({
      workspaceRoot: null,
      activeFile: null,
      buffers: [],
      diagnostics: [],
      git: null,
      terminal: "safe terminal tail",
      checks: [],
    });
    expect(result.buffers).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.git).toBeNull();
    expect(result.terminal).toBe("safe terminal tail");
  });
});
