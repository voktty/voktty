import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuickComposer } from "./QuickComposer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("./useQuickPickerMotion", () => ({ useQuickPickerMotion: () => {} }));
vi.mock("./QuickWorkspaceControls", () => ({ QuickWorkspaceControls: () => null }));
vi.mock("./QuickProjectIcon", () => ({
  QuickProjectIcon: () => null,
  loadQuickProjectAppearance: () => ({}),
}));
vi.mock("./QuickModelSelector", () => ({ QuickModelSelector: () => null }));
vi.mock("./useQuickAttachments", () => ({
  useQuickAttachments: () => ({ files: [], clear: () => {} }),
}));
vi.mock("../model/quickComposer", async (actual) => ({
  ...(await actual<object>()),
  loadQuickProjects: () => ["/tmp/project"],
  initialQuickChoice: () => ({ harness: "codex", model: "test" }),
  resolveQuickModel: () => ({
    harness: "codex",
    id: "test",
    name: "Test model",
  }),
}));

describe("QuickComposer commands and shortcuts", () => {
  it("renders textarea and submit controls", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickComposer, { onShown: () => {} }),
    );

    expect(markup).toContain("<textarea");
    expect(markup).toContain('aria-label="Prompt"');
    expect(markup).toContain("Start");
  });
});
