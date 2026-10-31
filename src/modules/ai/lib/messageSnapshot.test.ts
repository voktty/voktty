import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { captureAiMessageSnapshot } from "@/modules/ai/lib/messageSnapshot";

const messages = (text = "original"): UIMessage[] => [
  { id: "user", role: "user", parts: [{ type: "text", text }] },
];

it("captures independent message parts before asynchronous preparation", () => {
  const original = messages();
  const snapshot = captureAiMessageSnapshot(original);
  try {
    original[0].parts[0] = { type: "text", text: "changed" };
    expect(snapshot.messages).toEqual(messages());
    expect(snapshot.messages[0]).not.toBe(original[0]);
  } finally {
    snapshot.release();
  }
});

it("rejects accessors without evaluating user metadata", () => {
  let reads = 0;
  const original = messages();
  Object.defineProperty(original[0], "metadata", {
    enumerable: true,
    get() {
      reads++;
      return "private";
    },
  });
  expect(() => captureAiMessageSnapshot(original)).toThrow(/data-only/);
  expect(reads).toBe(0);
});

it("rejects non-data history before cloning", () => {
  const original = messages();
  original[0].metadata = new Map();
  expect(() => captureAiMessageSnapshot(original)).toThrow(/data-only/);
});

it("bounds both large text and sparse arrays", () => {
  expect(() =>
    captureAiMessageSnapshot(messages("x".repeat(16 * 1024 * 1024))),
  ).toThrow(/snapshot limits/);
  expect(() => captureAiMessageSnapshot(new Array<UIMessage>(65_537))).toThrow(
    /snapshot limits/,
  );
});

it("retains shared reservations until an idempotent release", () => {
  const held = Array.from({ length: 32 }, () =>
    captureAiMessageSnapshot(messages()),
  );
  try {
    expect(() => captureAiMessageSnapshot(messages())).toThrow(/still in use/);
    held[0].release();
    held[0].release();
    const next = captureAiMessageSnapshot(messages());
    try {
      expect(() => captureAiMessageSnapshot(messages())).toThrow(
        /still in use/,
      );
    } finally {
      next.release();
    }
  } finally {
    for (const snapshot of held) snapshot.release();
  }
});

it("bounds the total retained text across concurrent requests", () => {
  const text = "x".repeat(7 * 1024 * 1024);
  const first = captureAiMessageSnapshot(messages(text));
  const second = captureAiMessageSnapshot(messages(text));
  try {
    expect(() => captureAiMessageSnapshot(messages(text))).toThrow(
      /still in use/,
    );
  } finally {
    first.release();
    second.release();
  }
  const next = captureAiMessageSnapshot(messages(text));
  next.release();
});

it("rolls back reservations when the native clone rejects", () => {
  const original = messages();
  original[0] = new Proxy(original[0], {});
  for (let index = 0; index < 33; index++)
    expect(() => captureAiMessageSnapshot(original)).toThrow(/clone|cloned/i);
  const next = captureAiMessageSnapshot(messages());
  next.release();
});
