// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InlineAiWidget } from "@/modules/editor/components/InlineAiWidget";

let root: Root;
let node: HTMLDivElement;
const submit =
  vi.fn<(instruction: string, signal?: AbortSignal) => Promise<string>>();
const accept = vi.fn();
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
        onAccept={accept}
      />,
    ),
  );
}

it("aborts a closed request and never publishes it into a reopened widget", async () => {
  let finish!: (value: string) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  submit.mockResolvedValue("current proposal");
  await render(true);
  const signal = submit.mock.calls[0][1];
  await render(false);
  expect(signal?.aborted).toBe(true);
  await render(true, "replacement");
  expect(node.textContent).toContain("current proposal");
  await act(async () => finish("retired proposal"));
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
  let finish!: (value: string) => void;
  submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(true);
  const signal = submit.mock.calls[0][1];
  const replacement = vi.fn(async () => "new document");
  await act(async () =>
    root.render(
      <InlineAiWidget
        isOpen
        initialPrompt="fixture"
        onSubmit={replacement}
        onClose={close}
        onAccept={accept}
      />,
    ),
  );
  expect(signal?.aborted).toBe(true);
  await act(async () => finish("old document"));
  expect(node.textContent).not.toContain("old document");
});

it("replaces an in-flight initial prompt without adopting its old proposal", async () => {
  let finish!: (value: string) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  submit.mockResolvedValue("new prompt proposal");
  await render(true, "first prompt");
  const signal = submit.mock.calls[0][1];
  await render(true, "second prompt");
  expect(signal?.aborted).toBe(true);
  expect(submit).toHaveBeenCalledTimes(2);
  await act(async () => finish("first prompt proposal"));
  expect(node.textContent).toContain("new prompt proposal");
  expect(node.textContent).not.toContain("first prompt proposal");
});
