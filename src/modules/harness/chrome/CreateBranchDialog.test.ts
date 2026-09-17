import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateBranchDialog } from "./CreateBranchDialog";

describe("CreateBranchDialog", () => {
  it("renders modal with branch name input and actions", () => {
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(CreateBranchDialog, {
        busy: false,
        error: null,
        onCreate,
        onCancel,
      }),
    );

    expect(markup).toContain("New branch");
    expect(markup).toContain("Create and check out a branch in this project.");
    expect(markup).toContain("Branch name");
    expect(markup).toContain("Create branch");
    expect(markup).toContain("Cancel");
  });

  it("renders error message when present", () => {
    const markup = renderToStaticMarkup(
      createElement(CreateBranchDialog, {
        busy: false,
        error: "fatal: A branch named feature-dup already exists.",
        onCreate: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain("fatal: A branch named feature-dup already exists.");
  });
});
