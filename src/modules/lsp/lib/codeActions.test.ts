import { describe, expect, it } from "vitest";
import {
  boundedCodeActionDiagnostics,
  diagnosticsOverlappingRange,
  MAX_CODE_ACTIONS,
  normalizeCodeActions,
  prepareWorkspaceEditForDocument,
} from "./codeActions";

describe("LSP code actions", () => {
  it("normalizes, bounds and prioritizes code actions", () => {
    const actions = normalizeCodeActions([
      {
        title: "Add missing import",
        kind: "quickfix",
        isPreferred: true,
        edit: { changes: {} },
      },
      { title: "Organize imports", command: "source.organizeImports" },
      { title: "Disabled action", disabled: { reason: "Not available" } },
      { title: "" },
      null,
    ]);

    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatchObject({
      title: "Add missing import",
      kind: "quickfix",
      preferred: true,
      needsResolve: false,
    });
    expect(actions[1]).toMatchObject({
      title: "Disabled action",
      disabledReason: "Not available",
    });
    expect(actions[2]).toMatchObject({
      title: "Organize imports",
      command: { command: "source.organizeImports" },
    });

    expect(
      normalizeCodeActions(
        Array.from({ length: MAX_CODE_ACTIONS + 25 }, (_, index) => ({
          title: `Action ${index}`,
        })),
      ),
    ).toHaveLength(MAX_CODE_ACTIONS);
  });

  it("prepares bounded current-document edits in original coordinates", () => {
    const uri = "file:///repo/main.ts";
    expect(
      prepareWorkspaceEditForDocument("const value = old;\n", uri, {
        changes: {
          [uri]: [
            {
              range: {
                start: { line: 0, character: 14 },
                end: { line: 0, character: 17 },
              },
              newText: "next",
            },
            {
              range: {
                start: { line: 1, character: 0 },
                end: { line: 1, character: 0 },
              },
              newText: "export {};\n",
            },
          ],
        },
      }),
    ).toEqual({
      kind: "applicable",
      changes: [
        { from: 14, to: 17, insert: "next" },
        { from: 19, to: 19, insert: "export {};\n" },
      ],
    });
  });

  it("routes multi-document and resource edits to safe preview", () => {
    const uri = "file:///repo/main.ts";
    expect(
      prepareWorkspaceEditForDocument("let x = 1;", uri, {
        changes: {
          [uri]: [],
          "file:///repo/other.ts": [],
        },
      }),
    ).toMatchObject({
      kind: "requires-preview",
      uris: ["file:///repo/main.ts", "file:///repo/other.ts"],
    });

    expect(
      prepareWorkspaceEditForDocument("let x = 1;", uri, {
        documentChanges: [
          {
            kind: "rename",
            oldUri: uri,
            newUri: "file:///repo/renamed.ts",
          },
        ],
      }),
    ).toMatchObject({ kind: "requires-preview" });
  });

  it("rejects invalid or overlapping edits", () => {
    const uri = "file:///repo/main.ts";
    expect(
      prepareWorkspaceEditForDocument("abcdef", uri, {
        changes: {
          [uri]: [
            {
              range: {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 4 },
              },
              newText: "x",
            },
            {
              range: {
                start: { line: 0, character: 3 },
                end: { line: 0, character: 5 },
              },
              newText: "y",
            },
          ],
        },
      }),
    ).toEqual({ kind: "invalid" });

    expect(
      prepareWorkspaceEditForDocument("abcdef", uri, {
        changes: {
          [uri]: [
            {
              range: {
                start: { line: 2, character: 0 },
                end: { line: 2, character: 1 },
              },
              newText: "x",
            },
          ],
        },
      }),
    ).toEqual({ kind: "invalid" });
  });

  it("keeps bounded raw diagnostics and selects those overlapping a range", () => {
    const diagnostics = boundedCodeActionDiagnostics([
      {
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 8 },
        },
        severity: 1,
        message: "Expected a value",
        data: { fixId: "add-value" },
      },
      {
        range: {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 3 },
        },
        message: "Elsewhere",
      },
      { message: "Missing range" },
    ]);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({ data: { fixId: "add-value" } });
    expect(
      diagnosticsOverlappingRange(diagnostics, {
        start: { line: 1, character: 5 },
        end: { line: 1, character: 5 },
      }),
    ).toEqual([diagnostics[0]]);
  });
});
