// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InlineAiWidget } from "@/modules/editor/components/InlineAiWidget";
import type { InlineEditProposal } from "@/modules/editor/lib/inlineEditTarget";
import { t } from "@/modules/i18n";

let root: Root;
let node: HTMLDivElement;
const submit =
  vi.fn<
    (instruction: string, signal?: AbortSignal) => Promise<InlineEditProposal>
  >();
function proposal(text: string): InlineEditProposal {
  return { text, apply: vi.fn(() => true), discard: vi.fn() };
}
const close = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
async function render(open: boolean, prompt = "fixture") {
  await act(async () =>
    root.render(
      <InlineAiWidget
        isOpen={open}
        initialPrompt={prompt}
        onSubmit={submit}
        onClose={close}
      />,
    ),
  );
}

it("aborts a closed request and never publishes it into a reopened widget", async () => {
  let finish!: (value: InlineEditProposal) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  submit.mockResolvedValue(proposal("current proposal"));
  await render(true);
  const signal = submit.mock.calls[0][1];
  await render(false);
  expect(signal?.aborted).toBe(true);
  await render(true, "replacement");
  expect(node.textContent).toContain("current proposal");
  const retired = proposal("retired proposal");
  await act(async () => finish(retired));
  expect(retired.discard).toHaveBeenCalledOnce();
  expect(node.textContent).toContain("current proposal");
  expect(node.textContent).not.toContain("retired proposal");
});

it("suppresses retired errors and releases cancellation on unmount", async () => {
  let fail!: (error: Error) => void;
  submit.mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await render(true);
  const signal = submit.mock.calls[0][1];
  await act(async () => root.unmount());
  expect(signal?.aborted).toBe(true);
  await act(async () => fail(new Error("retired failure")));
  expect(node.textContent).toBe("");
});

it("retires a request when the document's submit callback is replaced", async () => {
  let finish!: (value: InlineEditProposal) => void;
  submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(true);
  const signal = submit.mock.calls[0][1];
  const replacement = vi.fn(async () => proposal("new document"));
  await act(async () =>
    root.render(
      <InlineAiWidget
        isOpen
        initialPrompt="fixture"
        onSubmit={replacement}
        onClose={close}
      />,
    ),
  );
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(proposal("old document")));
  expect(node.textContent).not.toContain("old document");
});

it("replaces an in-flight initial prompt without adopting its old proposal", async () => {
  let finish!: (value: InlineEditProposal) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  submit.mockResolvedValue(proposal("new prompt proposal"));
  await render(true, "first prompt");
  const signal = submit.mock.calls[0][1];
  await render(true, "second prompt");
  expect(signal?.aborted).toBe(true);
  expect(submit).toHaveBeenCalledTimes(2);
  await act(async () => finish(proposal("first prompt proposal")));
  expect(node.textContent).toContain("new prompt proposal");
  expect(node.textContent).not.toContain("first prompt proposal");
});

it("consumes a proposal once across keyboard and button delivery", async () => {
  const own = proposal("current");
  submit.mockResolvedValue(own);
  await render(true);
  const widget = node.querySelector("[data-inline-ai-widget]");
  await act(async () => {
    widget?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    widget?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
  });
  const button = [...node.querySelectorAll("button")].find(
    (item) => item.textContent === t("editor.inlineAi.apply"),
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
  expect(own.apply).toHaveBeenCalledOnce();
});

it("keeps a rejected application visible with a document-changed explanation", async () => {
  const own = { ...proposal("current"), apply: vi.fn(() => false) };
  submit.mockResolvedValue(own);
  await render(true);
  const button = [...node.querySelectorAll("button")].find(
    (item) => item.textContent === t("editor.inlineAi.apply"),
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
  expect(node.querySelector('[role="alert"]')?.textContent).toBe(
    t("editor.codeActions.documentChanged"),
  );
  expect(close).not.toHaveBeenCalled();
  expect(node.textContent).toContain("current");
});

it("discards completed proposals when closing or modifying the instruction", async () => {
  const first = proposal("first");
  submit.mockResolvedValue(first);
  await render(true);
  const modify = [...node.querySelectorAll("button")].find(
    (item) => item.textContent === t("editor.inlineAi.modifyInstruction"),
  );
  expect(modify).toBeDefined();
  await act(async () => modify?.click());
  expect(first.discard).toHaveBeenCalledOnce();
  expect(first.apply).not.toHaveBeenCalled();
  const second = proposal("second");
  submit.mockResolvedValue(second);
  await render(true, "replacement");
  await render(false);
  expect(second.discard).toHaveBeenCalledOnce();
});
