import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

const saveGeneratedImage = vi.hoisted(() =>
  vi.fn(async () => ({
    path: "/app-data/generated-images/image.png",
    mimeType: "image/png",
    size: 8,
  })),
);
const deleteGeneratedImages = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../fs", () => ({
  saveGeneratedImage,
  deleteGeneratedImages,
}));

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const {
  bindCodexSession,
  cancelCodexTurn,
  sendCodexTurn,
  stopCodexSession,
  respondCodexQuestion,
  keepCodexQuestionOpen,
  __codexTestReset,
} = await import("./codex");
import type { HarnessEvent } from "./types";
import type { RuntimeMode, TurnIntent } from "../session";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ id, result }));
}

function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ method, params }));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.method ?? `reply:${m.id}`))}`,
  );
};

async function startTurn(
  sessionId: string,
  options: {
    runtimeMode?: RuntimeMode;
    intent?: TurnIntent;
    resume?: boolean;
    providerAccountId?: string;
    resumeProviderAccountId?: string;
    expectResume?: boolean;
    beforeThreadReply?: () => Promise<void>;
  } = {},
) {
  const events: HarnessEvent[] = [];
  if (options.resume) {
    bindCodexSession(
      sessionId,
      "thr_1",
      "/repo",
      options.resumeProviderAccountId,
    );
  }
  const turn = sendCodexTurn({
    sessionId,
    cwd: "/repo",
    model: "codex:gpt-5.4",
    modelSettings: {},
    providerAccountId: options.providerAccountId,
    runtimeMode: options.runtimeMode ?? "supervised",
    intent: options.intent,
    text: "summarize the changelog",
    attachments: [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () => parse().some((m) => m.method === "initialize"),
    "initialize",
  );
  reply(parse().find((m) => m.method === "initialize")!.id as number, {});
  const threadMethod =
    (options.expectResume ?? options.resume) ? "thread/resume" : "thread/start";
  await waitFor(
    () => parse().some((m) => m.method === threadMethod),
    threadMethod,
  );
  if (options.beforeThreadReply) {
    await options.beforeThreadReply();
  }
  reply(parse().find((m) => m.method === threadMethod)!.id as number, {
    thread: { id: "thr_1" },
  });
  await waitFor(
    () => parse().some((m) => m.method === "turn/start"),
    "turn/start",
  );
  reply(parse().find((m) => m.method === "turn/start")!.id as number, {
    turn: { id: "turn_1", status: "inProgress" },
  });
  notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
  await Promise.resolve();
  return { events, turn };
}

function notifyAsyncQuestion(id: string, turnId = "turn_1") {
  notify("item/completed", {
    threadId: "thr_1",
    turnId,
    item: {
      type: "agentMessage",
      id,
      text: "Which source?",
      delivery: "async",
      questions: [{ title: "Which source?", options: ["Local", "Remote"] }],
    },
  });
}
describe("Codex async question lifecycle", () => {
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await stopCodexSession("codex-live");
    __codexTestReset();
  });
  it("shows async questions without blocking later messages and steers with the answer", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("async_question");
    const question = events.find((event) => event.type === "question.asked")!;
    expect(question).toMatchObject({
      callId: "async_question",
      questions: [{ id: "q1", prompt: "Which source?", allowCustom: true }],
    });
    expect(question.autoResolveAt).toBeGreaterThan(Date.now());
    notify("item/agentMessage/delta", {
      itemId: "next",
      delta: "Still working",
    });
    expect(events).toContainEqual({
      type: "message.delta",
      text: "Still working",
    });
    expect(parse().some((message) => message.method === "turn/steer")).toBe(
      false,
    );
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: { q1: ["Remote"] },
    });
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: { q1: ["Remote"] },
    });
    const steer = parse().find((message) => message.method === "turn/steer")!;
    expect(steer.params).toEqual({
      threadId: "thr_1",
      expectedTurnId: "turn_1",
      input: [{ type: "text", text: "Which source?\nRemote" }],
    });
    expect(
      parse().filter((message) => message.method === "turn/steer"),
    ).toHaveLength(1);
    expect(events.some((event) => event.type === "question.resolved")).toBe(
      false,
    );
    reply(steer.id as number, {});
    await waitFor(
      () => events.some((event) => event.type === "question.resolved"),
      "async answer acceptance",
    );
    expect(events).toContainEqual({
      type: "question.resolved",
      requestId: question.requestId,
      decision: "answered",
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("queues async and server-request questions together and ignores repeated snapshots", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("async_first");
    notifyAsyncQuestion("async_first");
    onLine!(
      JSON.stringify({
        id: "legacy_question",
        method: "item/tool/requestUserInput",
        params: {
          questions: [{ id: "legacy", question: "Continue?", options: null }],
        },
      }),
    );
    notifyAsyncQuestion("async_last");
    const asked = () =>
      events.filter((event) => event.type === "question.asked");
    expect(asked()).toHaveLength(1);
    respondCodexQuestion("codex-live", asked()[0].requestId, {
      kind: "skipped",
    });
    await waitFor(() => asked().length === 2, "queued server question");
    expect(asked()[1].questions[0].id).toBe("legacy");
    respondCodexQuestion("codex-live", asked()[1].requestId, {
      kind: "skipped",
    });
    await waitFor(() => asked().length === 3, "queued async question");
    expect(
      parse().find((message) => message.id === "legacy_question")?.result,
    ).toEqual({ answers: {} });
    expect(asked()[2].callId).toBe("async_last");
    respondCodexQuestion("codex-live", asked()[2].requestId, {
      kind: "skipped",
    });
    await waitFor(
      () =>
        events.filter((event) => event.type === "question.resolved").length ===
        3,
      "question queue cleanup",
    );
    notifyAsyncQuestion("async_first");
    expect(asked()).toHaveLength(3);
    expect(parse().some((message) => message.method === "turn/steer")).toBe(
      false,
    );
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("keeps an async question available when sending its answer fails", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("async_question");
    const question = events.find((event) => event.type === "question.asked")!;
    const answer = {
      kind: "answered" as const,
      answers: {},
      custom: { q1: "Another source" },
    };
    respondCodexQuestion("codex-live", question.requestId, answer);
    const steer = parse().find((message) => message.method === "turn/steer")!;
    onLine!(
      JSON.stringify({
        id: steer.id,
        error: { code: -32602, message: "Try again" },
      }),
    );
    await waitFor(
      () => events.some((event) => event.type === "status"),
      "failed async answer delivery",
    );
    expect(events.some((event) => event.type === "question.resolved")).toBe(
      false,
    );
    expect(events).toContainEqual({
      type: "status",
      text: "Try again",
    });
    respondCodexQuestion("codex-live", question.requestId, answer);
    const retry = parse().filter(
      (message) => message.method === "turn/steer",
    )[1];
    expect(retry.params).toMatchObject({
      input: [{ type: "text", text: "Which source?\nAnother source" }],
    });
    reply(retry.id as number, {});
    await waitFor(
      () => events.some((event) => event.type === "question.resolved"),
      "retried async answer",
    );
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each([false, true])(
    "optional async questions honor interaction=%s",
    async (interact) => {
      const { events, turn } = await startTurn("codex-live");
      vi.useFakeTimers();
      notifyAsyncQuestion("async_question");
      const question = events.find((event) => event.type === "question.asked")!;
      await vi.advanceTimersByTimeAsync(60_000);
      if (interact) keepCodexQuestionOpen("codex-live", question.requestId);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(events.some((event) => event.type === "question.resolved")).toBe(
        !interact,
      );
      if (!interact)
        expect(events).toContainEqual({
          type: "question.resolved",
          requestId: question.requestId,
          decision: "skipped",
        });
      expect(parse().some((message) => message.method === "turn/steer")).toBe(
        false,
      );
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
    },
  );

  it.each(["complete", "cancel", "stop"])(
    "clears async questions on %s without sending a stale answer",
    async (action) => {
      const { events, turn } = await startTurn("codex-live");
      notifyAsyncQuestion("async_question");
      const question = events.find((event) => event.type === "question.asked")!;
      if (action === "cancel") {
        const cancel = cancelCodexTurn("codex-live");
        const interrupt = parse().find(
          (message) => message.method === "turn/interrupt",
        )!;
        reply(interrupt.id as number, {});
        await cancel;
      } else if (action === "stop") await stopCodexSession("codex-live");
      else
        notify("turn/completed", {
          turn: { id: "turn_1", status: "completed" },
        });
      await turn;
      await waitFor(
        () => events.some((event) => event.type === "question.resolved"),
        "async question cancellation",
      );
      respondCodexQuestion("codex-live", question.requestId, {
        kind: "answered",
        answers: { q1: ["Local"] },
      });
      expect(events).toContainEqual({
        type: "question.resolved",
        requestId: question.requestId,
        decision: "cancelled",
      });
      expect(parse().some((message) => message.method === "turn/steer")).toBe(
        false,
      );
    },
  );

  it("ignores async questions from a different turn", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("old_question", "turn_old");
    expect(events.some((event) => event.type === "question.asked")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });
});
