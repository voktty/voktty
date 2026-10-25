// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { beforeEach, expect, it, vi } from "vitest";
import { formatDocumentAndWait } from "@/modules/lsp/lib/client";

const edits = [
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    newText: "new",
  },
];
let request: ReturnType<typeof vi.fn<() => Promise<typeof edits>>>;
let dispatch: ReturnType<typeof vi.fn<() => void>>;
let plugin: {
  documentUri: string;
  client: {
    ready: boolean;
    capabilities: { documentFormattingProvider: boolean };
    textDocumentFormatting: typeof request;
  };
};
let view: EditorView;
beforeEach(() => {
  request = vi.fn(async () => edits);
  dispatch = vi.fn<() => void>();
  plugin = {
    documentUri: "file:///work/old.ts",
    client: {
      ready: true,
      capabilities: { documentFormattingProvider: true },
      textDocumentFormatting: request,
    },
  };
  view = {
    state: EditorState.create({ doc: "old" }),
    plugin: () => plugin,
    dispatch,
  } as unknown as EditorView;
});
it("does not request formatting under a retired caller", async () => {
  await formatDocumentAndWait(view, () => false);
  expect(request).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});
it("does not dispatch an unchanged-text response after caller retirement", async () => {
  let finish!: (result: typeof edits) => void;
  request.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let current = true;
  const pending = formatDocumentAndWait(view, () => current);
  current = false;
  finish(edits);
  await pending;
  expect(dispatch).not.toHaveBeenCalled();
});
it.each(["plugin", "uri", "client"] as const)(
  "does not dispatch an old response after %s replacement with identical text",
  async (change) => {
    let finish!: (result: typeof edits) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = formatDocumentAndWait(view);
    if (change === "plugin") plugin = { ...plugin };
    if (change === "uri") plugin.documentUri = "file:///work/new.ts";
    if (change === "client") plugin.client = { ...plugin.client };
    finish(edits);
    await pending;
    expect(dispatch).not.toHaveBeenCalled();
  },
);

it("retains the existing guard against typing during a formatting request", async () => {
  let finish!: (result: typeof edits) => void;
  request.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = formatDocumentAndWait(view);
  Object.defineProperty(view, "state", {
    value: EditorState.create({ doc: "typed" }),
  });
  finish(edits);
  await pending;
  expect(dispatch).not.toHaveBeenCalled();
});
it("keeps current format edits and the existing awaitable result", async () => {
  expect(await formatDocumentAndWait(view)).toBe("done");
  expect(dispatch).toHaveBeenCalledWith({
    changes: [{ from: 0, to: 3, insert: "new" }],
  });
});
