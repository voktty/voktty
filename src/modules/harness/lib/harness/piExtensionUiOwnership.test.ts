import * as child from "@/modules/harness/lib/harness/child";
import {
  cancelTurn,
  forgetSession,
  respondApproval,
  respondQuestion,
  sendTurn,
  setPiBinaryResolver,
  stopSession,
} from "@/modules/harness/lib/harness/piFamily";
import {
  OMP_FLAVOR,
  PI_FLAVOR,
  type PiFlavor,
} from "@/modules/harness/lib/harness/piFlavor";
import type {
  HarnessEvent,
  SendTurnInput,
} from "@/modules/harness/lib/harness/types";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

type Request = { nativeId: string; command: Record<string, unknown> };
type UiCase = {
  label: string;
  flavor: PiFlavor;
  method: "confirm" | "select" | "input" | "editor";
};
const cases: UiCase[] = [
  { label: "pi confirm", flavor: PI_FLAVOR, method: "confirm" },
  { label: "pi select", flavor: PI_FLAVOR, method: "select" },
  { label: "omp confirm", flavor: OMP_FLAVOR, method: "confirm" },
  { label: "omp select", flavor: OMP_FLAVOR, method: "select" },
  { label: "omp input", flavor: OMP_FLAVOR, method: "input" },
  { label: "omp editor", flavor: OMP_FLAVOR, method: "editor" },
];
const RAW_CHOICE = "\u001b[31moriginal second\u001b[0m";
const writes: Request[] = [];
const spawns: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let release: (() => void) | undefined;
let autoPrompt = true;
function observed<T extends Promise<unknown>>(promise: T): T {
  void promise.catch(() => undefined);
  return promise;
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function frame(nativeId: string, value: Record<string, unknown>) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: nativeId, line: JSON.stringify(value) },
  });
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  hook?: (event: HarnessEvent) => void,
): SendTurnInput {
  return {
    sessionId: "ui-owner",
    cwd: "/repo",
    model: `${flavor.id}:default`,
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => {
      events.push(event);
      hook?.(event);
    },
  };
}
async function active(test: UiCase, hook?: (event: HarnessEvent) => void) {
  autoPrompt = true;
  await sendTurn(test.flavor, input(test.flavor));
  autoPrompt = false;
  const events: HarnessEvent[] = [];
  const turn = observed(
    sendTurn(test.flavor, input(test.flavor, events, hook)),
  );
  await flush();
  const nativeId = spawns[spawns.length - 1];
  if (!nativeId) throw new Error("Expected captured UI actor");
  return { turn, events, nativeId };
}
function ask(test: UiCase, nativeId: string) {
  frame(nativeId, {
    type: "extension_ui_request",
    id: "native-ui",
    method: test.method,
    title: "Local request",
    options: ["first", RAW_CHOICE],
  });
}
function answer(test: UiCase, events: HarnessEvent[]) {
  const asked = events.find(
    (event) =>
      event.type === "approval.requested" || event.type === "question.asked",
  );
  if (
    !asked ||
    (asked.type !== "approval.requested" && asked.type !== "question.asked")
  )
    throw new Error("Expected published UI resolver");
  if (asked.type === "approval.requested")
    respondApproval(test.flavor, "ui-owner", asked.requestId, "allow");
  else
    respondQuestion(test.flavor, "ui-owner", asked.requestId, {
      kind: "answered",
      answers: test.method === "select" ? { "native-ui": ["1"] } : {},
      custom:
        test.method === "select" ? {} : { "native-ui": "original user value" },
    });
}
function replies() {
  return writes.filter((row) => row.command.type === "extension_ui_response");
}
function resolutions(events: HarnessEvent[]) {
  return events.filter(
    (event) =>
      event.type === "approval.resolved" || event.type === "question.resolved",
  );
}
function positive(test: UiCase) {
  return {
    type: "extension_ui_response",
    id: "native-ui",
    ...(test.method === "confirm"
      ? { confirmed: true }
      : {
          value:
            test.flavor.id === "pi"
              ? "first"
              : test.method === "select"
                ? RAW_CHOICE
                : "original user value",
        }),
  };
}
function negativeResolution(test: UiCase, events: HarnessEvent[]) {
  const question = test.flavor.id === "omp" && test.method !== "confirm";
  expect(resolutions(events)).toEqual([
    expect.objectContaining({
      type: question ? "question.resolved" : "approval.resolved",
      decision: question ? "skipped" : "deny",
    }),
  ]);
}
function denied(nativeId: string) {
  expect(replies()).toEqual([
    {
      nativeId,
      command: {
        type: "extension_ui_response",
        id: "native-ui",
        cancelled: true,
      },
    },
  ]);
}
beforeAll(async () => {
  child.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      const nativeId = String(args.sessionId);
      if (command === "harness_spawn") {
        spawns.push(nativeId);
        return 123 as T;
      }
      if (command === "harness_write") {
        const request = {
          nativeId,
          command: JSON.parse(String(args.line)) as Record<string, unknown>,
        };
        writes.push(request);
        if (request.command.type === "extension_ui_response")
          return undefined as T;
        frame(nativeId, {
          type: "response",
          id: request.command.id,
          command: request.command.type,
          success: true,
          data:
            request.command.type === "get_state"
              ? { sessionId: `provider_${nativeId}` }
              : {},
        });
        if (request.command.type === "prompt" && autoPrompt)
          frame(nativeId, { type: "agent_settled" });
      }
      return undefined as T;
    },
    async listen<T>(event: string, handler: (event: { payload: T }) => void) {
      listeners.set(event, handler as (event: { payload: unknown }) => void);
      return () => {
        listeners.delete(event);
      };
    },
  });
  release = await child.acquireHarnessBridge();
});
afterAll(() => release?.());
beforeEach(() => {
  writes.length = 0;
  spawns.length = 0;
  autoPrompt = true;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    await forgetSession(flavor, "ui-owner");
  await flush();
});
describe.each(cases)("$label captured extension UI operation", (test) => {
  it("preserves synchronous answers, opaque values and the owning resolution event", async () => {
    let events: HarnessEvent[] = [];
    const activeTurn = await active(test, (event) => {
      if (
        event.type === "approval.requested" ||
        event.type === "question.asked"
      )
        answer(test, events);
    });
    events = activeTurn.events;
    ask(test, activeTurn.nativeId);
    await flush();
    expect(replies()).toEqual([
      { nativeId: activeTurn.nativeId, command: positive(test) },
    ]);
    expect(resolutions(events)).toHaveLength(1);
    frame(activeTurn.nativeId, { type: "agent_settled" });
    await activeTurn.turn;
  });
  it("revokes an already fulfilled positive answer on synchronous cancellation", async () => {
    const { turn, events, nativeId } = await active(test);
    ask(test, nativeId);
    answer(test, events);
    const cancelled = observed(cancelTurn(test.flavor, "ui-owner"));
    await cancelled;
    await turn;
    await flush();
    denied(nativeId);
    negativeResolution(test, events);
    autoPrompt = true;
    const freshEvents: HarnessEvent[] = [];
    await sendTurn(test.flavor, input(test.flavor, freshEvents));
    expect(resolutions(freshEvents)).toEqual([]);
    denied(nativeId);
    expect(spawns).toHaveLength(1);
  });
  it("settles a still-pending cancelled UI request negatively without a stale event", async () => {
    const { turn, events, nativeId } = await active(test);
    ask(test, nativeId);
    await cancelTurn(test.flavor, "ui-owner");
    await turn;
    await flush();
    denied(nativeId);
    negativeResolution(test, events);
  });
  it("revokes a requested-callback synchronous answer followed by cancellation", async () => {
    let events: HarnessEvent[] = [];
    let cancelled: Promise<void> | undefined;
    const activeTurn = await active(test, (event) => {
      if (
        event.type === "approval.requested" ||
        event.type === "question.asked"
      ) {
        answer(test, events);
        cancelled = observed(cancelTurn(test.flavor, "ui-owner"));
      }
    });
    events = activeTurn.events;
    ask(test, activeTurn.nativeId);
    expect(cancelled).toBeDefined();
    await cancelled;
    await activeTurn.turn;
    await flush();
    denied(activeTurn.nativeId);
    negativeResolution(test, events);
  });
  it("revalidates cancellation in the resolved callback before positive native write", async () => {
    let cancelled: Promise<void> | undefined;
    const { turn, events, nativeId } = await active(test, (event) => {
      if (
        event.type === "approval.resolved" ||
        event.type === "question.resolved"
      )
        cancelled = observed(cancelTurn(test.flavor, "ui-owner"));
    });
    ask(test, nativeId);
    answer(test, events);
    await flush();
    expect(cancelled).toBeDefined();
    await cancelled;
    await turn;
    denied(nativeId);
    expect(resolutions(events)).toHaveLength(1);
  });
  it("skips old native writes after reentrant stop from the resolved callback", async () => {
    let stopped: Promise<void> | undefined;
    const { turn, events, nativeId } = await active(test, (event) => {
      if (
        event.type === "approval.resolved" ||
        event.type === "question.resolved"
      )
        stopped = observed(stopSession(test.flavor, "ui-owner"));
    });
    ask(test, nativeId);
    answer(test, events);
    await flush();
    expect(stopped).toBeDefined();
    await stopped;
    await turn;
    expect(replies()).toEqual([]);
    autoPrompt = true;
    await sendTurn(test.flavor, input(test.flavor));
    expect(spawns).toHaveLength(2);
    expect(replies()).toEqual([]);
  });
  it("retains the request's original UI sink across ordinary same-token turns", async () => {
    const { turn, events, nativeId } = await active(test);
    ask(test, nativeId);
    frame(nativeId, { type: "agent_settled" });
    await turn;
    const freshEvents: HarnessEvent[] = [];
    const fresh = observed(
      sendTurn(test.flavor, input(test.flavor, freshEvents)),
    );
    await flush();
    answer(test, events);
    await flush();
    expect(replies()).toEqual([{ nativeId, command: positive(test) }]);
    expect(resolutions(events)).toHaveLength(1);
    expect(resolutions(freshEvents)).toEqual([]);
    expect(spawns).toHaveLength(1);
    frame(nativeId, { type: "agent_settled" });
    await fresh;
  });
  it("does not deliver an already fulfilled old reply to a replacement", async () => {
    const { turn, events, nativeId } = await active(test);
    ask(test, nativeId);
    answer(test, events);
    const stopped = observed(stopSession(test.flavor, "ui-owner"));
    await stopped;
    await turn;
    autoPrompt = true;
    await sendTurn(test.flavor, input(test.flavor));
    await flush();
    expect(resolutions(events)).toEqual([]);
    expect(replies()).toEqual([]);
    expect(spawns).toHaveLength(2);
  });
});
