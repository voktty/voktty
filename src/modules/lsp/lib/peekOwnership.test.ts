// @vitest-environment happy-dom
import { EditorState, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { beforeEach, expect, it, vi } from "vitest";
import {
  lspInteractions,
  lspPeekForView,
  type VokttyLspClient,
} from "@/modules/lsp/lib/client";

const error = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error } }));
const location = {
  uri: "file:///work/target.ts",
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
};
let request: ReturnType<typeof vi.fn>;
let view: EditorView;
let state: EditorState;
function extension() {
  return lspInteractions({
    client: {
      ready: true,
      capabilities: { definitionProvider: true },
      textDocumentDefinition: request,
    } as unknown as VokttyLspClient,
    documentUri: "file:///work/source.ts",
    rootPath: "/work",
    onNavigate: () => true,
    semanticTokens: false,
    inlayHints: false,
  });
}
beforeEach(() => {
  error.mockReset();
  request = vi.fn(async () => [location]);
  state = EditorState.create({ doc: "source", extensions: extension() });
  view = {
    get state() {
      return state;
    },
  } as EditorView;
});
it("does not issue an RPC under retired authority", async () => {
  expect(await lspPeekForView(view, "definition", () => false)).toEqual({
    status: "stale",
  });
  expect(request).not.toHaveBeenCalled();
});
it("suppresses errors after caller retirement", async () => {
  let reject!: (error: Error) => void;
  request.mockReturnValue(
    new Promise((_, no) => {
      reject = no;
    }),
  );
  let current = true;
  const work = lspPeekForView(view, "definition", () => current);
  current = false;
  reject(new Error("late failure"));
  expect(await work).toEqual({ status: "stale" });
  expect(error).not.toHaveBeenCalled();
});
it("rejects replies after the same view rebinds its LSP interaction", async () => {
  let resolve!: (value: (typeof location)[]) => void;
  request.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const work = lspPeekForView(view, "definition");
  state = state.update({
    effects: StateEffect.reconfigure.of(extension()),
  }).state;
  resolve([location]);
  expect(await work).toEqual({ status: "stale" });
});
it("retires returned locations when the originating binding changes", async () => {
  const result = await lspPeekForView(view, "definition");
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected locations.");
  expect(result.isCurrent?.()).toBe(true);
  state = state.update({
    effects: StateEffect.reconfigure.of(extension()),
  }).state;
  expect(result.isCurrent?.()).toBe(false);
});
