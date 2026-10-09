// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "@/modules/harness/lib/session";
import { AgentTranscript } from "@/modules/harness/surfaces/AgentTranscript";
import { WORD_FADE_MS } from "@/modules/harness/surfaces/wordFade";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const reply =
  "The investigation is complete. The updated implementation keeps replies smooth while preserving your place in the transcript.";
const prompt: Block = { id: "prompt", role: "user", text: "Investigate" };

function history(): Block[] {
  return Array.from({ length: 25 }, (_, index): Block[] => [
    { id: `prompt-${index}`, role: "user", text: `Question ${index}` },
    { id: `answer-${index}`, role: "assistant", text: reply },
  ]).flat();
}

it("shows earlier replies immediately when expanding the local history page", () => {
  render(history(), false);
  expect(
    container.querySelector('[data-selectable-agent-response="answer-0"]'),
  ).toBeNull();
  const load = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Load earlier messages",
  );
  expect(load).toBeDefined();
  act(() => load?.click());
  const answer = container.querySelector(
    '[data-selectable-agent-response="answer-0"]',
  );
  expect(answer?.textContent).toBe(reply);
  expect(answer?.querySelector(".word-fading")).toBeNull();
});

it("reveals a reply through history search without replaying it", () => {
  let reveal: ((blockId: string) => boolean) | undefined;
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks: history(),
        busy: false,
        onRevealReady: (next) => {
          reveal = next;
        },
      }),
    ),
  );
  act(() => expect(reveal?.("answer-0")).toBe(true));
  const answer = container.querySelector(
    '[data-selectable-agent-response="answer-0"]',
  );
  expect(answer?.textContent).toBe(reply);
  expect(answer?.querySelector(".word-fading")).toBeNull();
});

function render(blocks: Block[], busy = true, visible = true) {
  act(() =>
    root.render(createElement(AgentTranscript, { blocks, busy, visible })),
  );
}

function answerText() {
  return container.querySelector(".agent-markdown")?.textContent ?? "";
}

it("paces a reply whose text and completion arrive in the same render", () => {
  render([prompt]);
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
  );
  expect(answerText()).toBe("");

  act(() => vi.advanceTimersByTime(100));
  expect(answerText().length).toBeGreaterThan(0);
  expect(answerText().length).toBeLessThan(reply.length);
  // A later transcript update must not flush the remainder.
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
  );
  act(() => vi.advanceTimersByTime(2_000));
  act(() => vi.advanceTimersByTime(WORD_FADE_MS));
  expect(answerText()).toBe(reply);
  expect(container.querySelector(".word-fading")).toBeNull();
});

it("paces the first nonempty chunk after an empty streaming block", () => {
  render([
    prompt,
    { id: "answer", role: "assistant", text: "", streaming: true },
  ]);
  render([
    prompt,
    { id: "answer", role: "assistant", text: reply, streaming: true },
  ]);
  expect(answerText()).toBe("");

  act(() => vi.advanceTimersByTime(100));
  expect(answerText().length).toBeGreaterThan(0);
  expect(answerText().length).toBeLessThan(reply.length);
});

it("shows an existing reply immediately when opening a conversation", () => {
  render([
    prompt,
    { id: "answer", role: "assistant", text: reply, streaming: true },
  ]);
  expect(answerText()).toBe(reply);
});

it("shows output received in a hidden tab immediately when switching to it", () => {
  render([prompt], true, false);
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
    false,
  );
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
  );
  expect(answerText()).toBe(reply);
  expect(container.querySelector(".word-fading")).toBeNull();
});
