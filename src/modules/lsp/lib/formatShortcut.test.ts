// @vitest-environment happy-dom
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { expect, it } from "vitest";
import {
  lspInteractions,
  type VokttyLspClient,
} from "@/modules/lsp/lib/client";

it("does not reclaim the formatting key after the shared shortcut dispatcher declines it", () => {
  const view = new EditorView({
    doc: "unchanged",
    parent: document.createElement("div"),
    extensions: lspInteractions({
      client: { ready: false } as VokttyLspClient,
      documentUri: "file:///project/file.ts",
      rootPath: "/project",
      onNavigate: () => false,
      semanticTokens: false,
      inlayHints: false,
    }),
  });
  try {
    const key = new KeyboardEvent("keydown", {
      key: "f",
      altKey: true,
      shiftKey: true,
      cancelable: true,
    });
    expect(runScopeHandlers(view, key, "editor")).toBe(false);
    expect(
      view.state
        .facet(keymap)
        .flat()
        .some((binding) => binding.key === "F2"),
    ).toBe(true);
  } finally {
    view.destroy();
  }
});
