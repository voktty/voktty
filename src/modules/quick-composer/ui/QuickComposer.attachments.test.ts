import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuickComposer } from "./QuickComposer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: vi.fn() }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  pickFiles: async () => ["/tmp/image.png"],
  basename: (path: string) => path.split("/").pop(),
  subscribeGitChanged: () => () => {},
  gitBranches: async () => null,
}));
vi.mock("./useQuickPickerMotion", () => ({ useQuickPickerMotion: () => {} }));
vi.mock("./QuickProjectIcon", () => ({
  QuickProjectIcon: () => null,
  loadQuickProjectAppearance: () => ({}),
}));
vi.mock("./QuickModelSelector", () => ({ QuickModelSelector: () => null }));
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

describe("QuickComposer attachments", () => {
  it("renders attachment trigger button", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickComposer, { onShown: () => {} }),
    );

    expect(markup).toContain('aria-label="Add attachment"');
  });
});
