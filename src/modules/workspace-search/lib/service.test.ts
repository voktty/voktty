import { normalizeWorkspaceSearchResponse } from "@/modules/workspace-search/lib/service";
import { describe, expect, it } from "vitest";

describe("workspace search response", () => {
  it("maps the native wire format without losing exact match locations", () => {
    expect(
      normalizeWorkspaceSearchResponse({
        hits: [
          {
            path: "/project/src/main.ts",
            rel: "src/main.ts",
            line: 7,
            column: 12,
            match_length: 6,
            preview_column: 7,
            text: "const widget = true;",
          },
        ],
        truncated: true,
        files_scanned: 42,
      }),
    ).toEqual({
      hits: [
        {
          path: "/project/src/main.ts",
          rel: "src/main.ts",
          line: 7,
          column: 12,
          matchLength: 6,
          previewColumn: 7,
          text: "const widget = true;",
        },
      ],
      truncated: true,
      filesScanned: 42,
    });
  });
});
