import { describe, expect, it } from "vitest";
import {
  collectWorkspaceProblems,
  MAX_PROBLEMS_PER_DOCUMENT,
  normalizeLspDiagnostics,
  type ProblemDocument,
  summarizeProblems,
} from "./problems";

describe("Problems workbench", () => {
  it("normalizes LSP ranges, severities and metadata", () => {
    const problems = normalizeLspDiagnostics("C:/repo/src/app.ts", [
      {
        range: {
          start: { line: 4, character: 7 },
          end: { line: 4, character: 12 },
        },
        severity: 1,
        message: "Unknown symbol",
        source: "typescript",
        code: 2304,
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 },
        },
        severity: 4,
        message: "Prefer const",
      },
    ]);

    expect(problems).toEqual([
      expect.objectContaining({
        path: "C:/repo/src/app.ts",
        line: 5,
        column: 8,
        endLine: 5,
        endColumn: 13,
        severity: "error",
        source: "typescript",
        code: "2304",
      }),
      expect.objectContaining({
        line: 2,
        column: 1,
        severity: "hint",
      }),
    ]);
  });

  it("rejects malformed diagnostics and caps each document", () => {
    const valid = Array.from(
      { length: MAX_PROBLEMS_PER_DOCUMENT + 20 },
      (_, index) => ({
        range: {
          start: { line: index, character: 0 },
          end: { line: index, character: 1 },
        },
        severity: 2,
        message: `Warning ${index}`,
      }),
    );
    const problems = normalizeLspDiagnostics("/repo/main.rs", [
      {
        range: {
          start: { line: -1, character: 0 },
          end: { line: 0, character: 1 },
        },
        message: "Invalid",
      },
      ...valid,
    ]);

    expect(problems).toHaveLength(MAX_PROBLEMS_PER_DOCUMENT);
    expect(problems[0].message).toBe("Warning 0");
  });

  it("rejects diagnostics whose range ends before it starts", () => {
    expect(
      normalizeLspDiagnostics("/repo/src/main.ts", [
        {
          range: {
            start: { line: 3, character: 8 },
            end: { line: 3, character: 2 },
          },
          message: "Inverted range",
        },
      ]),
    ).toEqual([]);
  });

  it("collects only problems inside the active workspace", () => {
    const documents: Record<string, ProblemDocument> = {
      first: {
        owner: "ts:C:/Repo",
        root: "C:/Repo",
        path: "C:/Repo/src/a.ts",
        problems: normalizeLspDiagnostics("C:/Repo/src/a.ts", [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            severity: 1,
            message: "A",
          },
        ]),
      },
      sibling: {
        owner: "ts:C:/Repo-old",
        root: "C:/Repo-old",
        path: "C:/Repo-old/src/b.ts",
        problems: normalizeLspDiagnostics("C:/Repo-old/src/b.ts", [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            severity: 2,
            message: "B",
          },
        ]),
      },
    };

    const problems = collectWorkspaceProblems(documents, "c:\\repo\\");
    expect(problems.map((problem) => problem.message)).toEqual(["A"]);
    expect(summarizeProblems(problems)).toEqual({
      errors: 1,
      warnings: 0,
      information: 0,
      hints: 0,
      total: 1,
    });
  });
});
