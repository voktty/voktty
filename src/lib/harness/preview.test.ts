import { describe, expect, it } from "vitest";
import {
  composeToolTitle,
  extractSearchQuery,
  extractToolPreview,
} from "./preview";

describe("extractToolPreview", () => {
  it("reads nested args bags from ACP tool calls", () => {
    const preview = extractToolPreview(
      {
        kind: "read",
        title: "Read",
        rawInput: {
          args: { path: "src/chrome/TitleBar.tsx" },
        },
      },
      {},
    );
    expect(preview).toMatchObject({
      kind: "read",
      path: "src/chrome/TitleBar.tsx",
      fileName: "TitleBar.tsx",
    });
    expect(
      composeToolTitle({
        kind: "read",
        title: "Read",
        path: preview?.path,
        previewKind: preview?.kind,
      }),
    ).toBe("Read src/chrome/TitleBar.tsx");
  });

  it("accepts relative single-segment paths", () => {
    const preview = extractToolPreview(
      { kind: "read", title: "Read", rawInput: { path: "README.md" } },
      {},
    );
    expect(preview?.path).toBe("README.md");
  });

  it("does not treat file contents as a path", () => {
    const preview = extractToolPreview(
      {
        kind: "read",
        title: "Read",
        rawInput: { path: "/** Structured language…" },
      },
      {},
    );
    expect(preview?.path).toBeUndefined();
  });

  it("finds search queries in nested input", () => {
    expect(
      extractSearchQuery([
        { arguments: { pattern: "busyHarness|busy.*tab" } },
      ]),
    ).toBe("busyHarness|busy.*tab");
  });

  it("uses locations when rawInput is empty", () => {
    const preview = extractToolPreview(
      {
        kind: "read",
        title: "Read",
        locations: [{ path: "src/App.tsx" }],
      },
      {},
    );
    expect(preview?.path).toBe("src/App.tsx");
  });

  it("treats glob_pattern as a Find query", () => {
    const preview = extractToolPreview(
      {
        kind: "search",
        title: "Find",
        name: "Glob",
        rawInput: { glob_pattern: "**/*.{json,md}" },
      },
      {},
    );
    expect(preview).toMatchObject({
      kind: "search",
      query: "**/*.{json,md}",
    });
    expect(
      composeToolTitle({
        kind: "search",
        title: "Find",
        query: preview?.query,
        previewKind: preview?.kind,
      }),
    ).toBe("Find **/*.{json,md}");
  });
});
