// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditorInlineEdit } from "@/modules/editor/lib/useEditorInlineEdit";
import type { WorkspaceEnv } from "@/modules/workspace";
import { InlineAiWidget } from "@/modules/editor/components/InlineAiWidget";
import { t } from "@/modules/i18n";

const io = vi.hoisted(() => ({ request: vi.fn(), applied: vi.fn() }));
vi.mock("@/modules/editor/lib/inlineEditService", () => ({
  requestInlineEdit: io.request,
}));
const local = { kind: "local" } as const;
let root: Root;
let view: EditorView;
let action: ReturnType<typeof useEditorInlineEdit>;
const views: EditorView[] = [];
function newView(doc = "alpha\nbeta\ngamma") {
  const result = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: 0, head: 5 },
      extensions: [history()],
    }),
    parent: document.body,
  });
  views.push(result);
  return result;
}
function Probe({
  workspace = local,
  path = "/work/file.ts",
}: {
  workspace?: WorkspaceEnv;
  path?: string;
}) {
  action = useEditorInlineEdit({
    path,
    workspaceEnv: workspace,
    getView: () => view,
    getLanguage: () => "ts",
    onApplied: io.applied,
  });
  return null;
}
async function render(workspace: WorkspaceEnv = local, path = "/work/file.ts") {
  await act(async () =>
    root.render(<Probe workspace={workspace} path={path} />),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  io.request.mockResolvedValue("replacement");
  view = newView();
  root = createRoot(document.createElement("div"));
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const item of views.splice(0)) item.destroy();
  vi.unstubAllGlobals();
});

it("applies to the original selection after the cursor moves during generation", async () => {
  let finish!: (value: string) => void;
  io.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = action("fixture");
  view.dispatch({ selection: { anchor: 11, head: 16 } });
  finish("replacement");
  const proposal = await pending;
  expect(proposal.apply()).toBe(true);
  expect(view.state.doc.toString()).toBe("replacement\nbeta\ngamma");
  expect(io.applied).toHaveBeenCalledOnce();
});

it("captures a complete line and matching prompt context for an empty selection", async () => {
  view.dispatch({ selection: { anchor: 8 } });
  const proposal = await action("fixture");
  expect(io.request.mock.calls[0][0]).toMatchObject({
    code: "beta",
    prefix: "alpha\n",
    suffix: "\ngamma",
  });
  view.dispatch({ selection: { anchor: 13 } });
  expect(proposal.apply()).toBe(true);
  expect(view.state.doc.toString()).toBe("alpha\nreplacement\ngamma");
});

it("preserves typing after a proposal is published", async () => {
  const proposal = await action("fixture");
  view.dispatch({ changes: { from: 5, insert: " user edit" } });
  const current = view.state.doc.toString();
  expect(proposal.apply()).toBe(false);
  expect(view.state.doc.toString()).toBe(current);
  expect(io.applied).not.toHaveBeenCalled();
});

it("rejects generation after its original buffer changes", async () => {
  let finish!: (value: string) => void;
  io.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = action("fixture");
  const rejected = expect(pending).rejects.toThrow();
  view.dispatch({ changes: { from: 5, insert: "!" } });
  finish("replacement");
  await rejected;
  expect(view.state.doc.toString()).toBe("alpha!\nbeta\ngamma");
  expect(io.applied).not.toHaveBeenCalled();
});

it("distinguishes successive proposals with identical text", async () => {
  const first = await action("first");
  view.dispatch({ selection: { anchor: 6, head: 10 } });
  const second = await action("second");
  expect(first.text).toBe(second.text);
  expect(first.apply()).toBe(false);
  first.discard();
  expect(second.apply()).toBe(true);
  expect(view.state.doc.toString()).toBe("alpha\nreplacement\ngamma");
});

it("consumes or discards only its exact proposal once", async () => {
  const proposal = await action("fixture");
  expect(proposal.apply()).toBe(true);
  expect(proposal.apply()).toBe(false);
  expect(io.applied).toHaveBeenCalledOnce();
  const discarded = await action("discard");
  discarded.discard();
  expect(discarded.apply()).toBe(false);
});

it("rejects a proposal whose original caller cancels after generation", async () => {
  const controller = new AbortController();
  const proposal = await action("fixture", controller.signal);
  controller.abort();
  expect(proposal.apply()).toBe(false);
  expect(view.state.doc.toString()).toBe("alpha\nbeta\ngamma");
});

it("retires old proposals across a same-path filesystem round trip", async () => {
  const proposal = await action("fixture");
  await render({ kind: "wsl", distro: "Ubuntu" });
  await render();
  expect(proposal.apply()).toBe(false);
  expect(view.state.doc.toString()).toBe("alpha\nbeta\ngamma");
});

it("cannot apply a proposal to a replacement view with identical text", async () => {
  const proposal = await action("fixture");
  view = newView();
  expect(proposal.apply()).toBe(false);
  expect(view.state.doc.toString()).toBe("alpha\nbeta\ngamma");
});

it("aborts admitted work and rejects its late result after unmount", async () => {
  let finish!: (value: string) => void;
  io.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = action("fixture");
  const rejected = expect(pending).rejects.toThrow();
  const signal = io.request.mock.calls[0][2] as AbortSignal;
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  finish("replacement");
  await rejected;
});

it("separates proposal history from earlier typing and supports undo and redo", async () => {
  view.dispatch({
    changes: { from: 5, insert: "!" },
    annotations: Transaction.userEvent.of("input.type"),
  });
  view.dispatch({ selection: { anchor: 0, head: 6 } });
  const proposal = await action("fixture");
  expect(proposal.apply()).toBe(true);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("alpha!\nbeta\ngamma");
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("replacement\nbeta\ngamma");
  expect(io.applied).toHaveBeenCalledOnce();
});

it("keeps prompt context bounded around the actual replacement range", async () => {
  view = newView(`${"x".repeat(1000)}\nalpha\n${"y".repeat(1000)}`);
  view.dispatch({ selection: { anchor: 1001, head: 1006 } });
  await action("fixture");
  const input = io.request.mock.calls[0][0];
  expect(input.code).toBe("alpha");
  expect(input.prefix).toHaveLength(400);
  expect(input.suffix).toHaveLength(400);
});

it("suppresses old view feedback when a dispatch observer replaces the view", async () => {
  const original = view;
  const replacement = newView();
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) view = replacement;
      }),
    ),
  });
  const proposal = await action("fixture");
  expect(proposal.apply()).toBe(true);
  expect(original.state.doc.toString()).toBe("replacement\nbeta\ngamma");
  expect(replacement.state.doc.toString()).toBe("alpha\nbeta\ngamma");
  expect(io.applied).not.toHaveBeenCalled();
});

it("retires a superseded request without replacing its successor's proposal", async () => {
  let finish!: (value: string) => void;
  io.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = action("first");
  const rejected = expect(first).rejects.toThrow();
  const signal = io.request.mock.calls[0][2] as AbortSignal;
  const second = await action("second");
  expect(signal.aborted).toBe(true);
  finish("retired");
  await rejected;
  expect(second.apply()).toBe(true);
  expect(view.state.doc.toString()).toBe("replacement\nbeta\ngamma");
});

function IntegratedWidget() {
  const submit = useEditorInlineEdit({
    path: "/work/file.ts",
    workspaceEnv: local,
    getView: () => view,
    getLanguage: () => "ts",
    onApplied: io.applied,
  });
  return (
    <InlineAiWidget
      isOpen
      initialPrompt="fixture"
      onSubmit={submit}
      onClose={() => {}}
    />
  );
}

it("keeps superseded requests charged until the admitted service calls settle", async () => {
  const finishes: Array<(value: string) => void> = [];
  io.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  const cohort = Promise.allSettled(
    Array.from({ length: 256 }, () => action("fixture")),
  );
  expect(io.request).toHaveBeenCalledTimes(256);
  await expect(action("overflow")).rejects.toThrow();
  expect(io.request).toHaveBeenCalledTimes(256);
  for (const finish of finishes) finish("replacement");
  const results = await cohort;
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    255,
  );
  const successful = results.filter((result) => result.status === "fulfilled");
  expect(successful).toHaveLength(1);
  if (successful[0].status === "fulfilled") successful[0].value.discard();
  io.request.mockResolvedValue("replacement");
  expect((await action("recovered")).apply()).toBe(true);
});

it.each([false, true])(
  "checks the captured buffer when applying through the real widget (edited: %s)",
  async (edited) => {
    const container = document.createElement("div");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<IntegratedWidget />));
    view.dispatch({ selection: { anchor: 11, head: 16 } });
    if (edited) view.dispatch({ changes: { from: 5, insert: " user edit" } });
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === t("editor.inlineAi.apply"),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(view.state.doc.toString()).toBe(
      edited ? "alpha user edit\nbeta\ngamma" : "replacement\nbeta\ngamma",
    );
    if (edited) {
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        t("editor.codeActions.documentChanged"),
      );
      expect(io.applied).not.toHaveBeenCalled();
    } else expect(io.applied).toHaveBeenCalledOnce();
  },
);
