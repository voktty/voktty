import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { previewFromTool } from "../lib/harness/claudeProtocol";
import { ToolDiffPreview } from "./ToolDiffPreview";

describe("ToolDiffPreview", () => {
  it("renders trigger button with label and correct accessibility attributes", () => {
    const preview = previewFromTool("Edit", {
      file_path: "/Users/me/Documents/notes.md",
      old_string: "  before\nkeep",
      new_string: "  after\nkeep",
    })!;

    const markup = renderToStaticMarkup(
      createElement(
        ToolDiffPreview,
        {
          preview,
          label: "notes.md",
          status: "accepted",
        },
        "notes.md",
      ),
    );

    expect(markup).toContain("<button");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain("notes.md");
  });

  it("handles write previews with contentOnly accurately", () => {
    const preview = previewFromTool("Write", {
      file_path: "notes.md",
      content: "new content",
    })!;

    const markup = renderToStaticMarkup(
      createElement(
        ToolDiffPreview,
        {
          preview,
          label: "notes.md",
          status: "accepted",
        },
        "notes.md",
      ),
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("notes.md");
  });
});
