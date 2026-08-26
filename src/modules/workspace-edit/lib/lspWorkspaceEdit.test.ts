import { describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_TEXT_EDITS,
  normalizeLspWorkspaceEdit,
} from "./lspWorkspaceEdit";

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
});

describe("LSP WorkspaceEdit normalization", () => {
  it("normalizes changes into deterministic workspace-relative documents", () => {
    expect(
      normalizeLspWorkspaceEdit("C:/repo", {
        changes: {
          "file:///C:/repo/src/z.ts": [
            { range: range(2, 4, 2, 7), newText: "next" },
          ],
          "file:///C:/repo/src/a.ts": [
            { range: range(0, 6, 0, 9), newText: "next" },
          ],
        },
      }),
    ).toEqual({
      kind: "ready",
      documents: [
        {
          path: "src/a.ts",
          edits: [{ range: range(0, 6, 0, 9), newText: "next" }],
        },
        {
          path: "src/z.ts",
          edits: [{ range: range(2, 4, 2, 7), newText: "next" }],
        },
      ],
      totalEdits: 2,
    });
  });

  it("supports TextDocumentEdit and merges repeated document entries", () => {
    expect(
      normalizeLspWorkspaceEdit("/repo", {
        documentChanges: [
          {
            textDocument: { uri: "file:///repo/main.ts", version: 3 },
            edits: [{ range: range(1, 0, 1, 3), newText: "one" }],
          },
          {
            textDocument: { uri: "file:///repo/main.ts", version: 3 },
            edits: [{ range: range(4, 0, 4, 3), newText: "two" }],
          },
        ],
      }),
    ).toMatchObject({
      kind: "ready",
      documents: [
        {
          path: "main.ts",
          edits: [
            { range: range(1, 0, 1, 3), newText: "one" },
            { range: range(4, 0, 4, 3), newText: "two" },
          ],
        },
      ],
      totalEdits: 2,
    });
  });

  it("rejects resource operations, external files and malformed ranges", () => {
    expect(
      normalizeLspWorkspaceEdit("/repo", {
        documentChanges: [
          {
            kind: "rename",
            oldUri: "file:///repo/a.ts",
            newUri: "file:///repo/b.ts",
          },
        ],
      }),
    ).toEqual({ kind: "unsupported", reason: "resource-operation" });

    expect(
      normalizeLspWorkspaceEdit("/repo", {
        changes: {
          "file:///outside.ts": [{ range: range(0, 0, 0, 1), newText: "x" }],
        },
      }),
    ).toEqual({ kind: "unsupported", reason: "outside-workspace" });

    expect(
      normalizeLspWorkspaceEdit("/repo", {
        changes: {
          "file:///repo/a.ts": [{ range: range(2, 3, 1, 4), newText: "x" }],
        },
      }),
    ).toEqual({ kind: "invalid", reason: "invalid-edit" });
  });

  it("rejects ambiguous payloads and bounded edit overflow", () => {
    expect(
      normalizeLspWorkspaceEdit("/repo", {
        changes: {},
        documentChanges: [],
      }),
    ).toEqual({ kind: "invalid", reason: "ambiguous-payload" });

    expect(
      normalizeLspWorkspaceEdit("/repo", {
        changes: {
          "file:///repo/a.ts": Array.from(
            { length: MAX_WORKSPACE_TEXT_EDITS + 1 },
            () => ({ range: range(0, 0, 0, 0), newText: "x" }),
          ),
        },
      }),
    ).toEqual({ kind: "invalid", reason: "limit-exceeded" });
  });

  it("reports an empty edit without opening a preview", () => {
    expect(normalizeLspWorkspaceEdit("/repo", { changes: {} })).toEqual({
      kind: "empty",
    });
  });
});
