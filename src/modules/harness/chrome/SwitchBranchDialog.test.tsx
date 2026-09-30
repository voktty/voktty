import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SwitchBranchDialog } from "./SwitchBranchDialog";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.name ? `${key}:${params.name}` : key,
  }),
}));

describe("SwitchBranchDialog", () => {
  it("renders branch name, textarea, and action buttons in static markup", () => {
    const markup = renderToStaticMarkup(
      createElement(SwitchBranchDialog, {
        cwd: "/repo",
        branch: "feature-branch",
        busy: null,
        onStash: vi.fn(),
        onCommit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain("feature-branch");
    expect(markup).toContain("<textarea");
    expect(markup).toContain("harness.chrome.generateCommit");
    expect(markup).toContain("harness.chrome.commitAndSwitch");
    expect(markup).toContain("harness.chrome.stashAndSwitch");
  });
});
