import * as child from "@/modules/harness/lib/harness/child";
import {
  createPiRpcCommandFailure,
  isPiRpcCommandFailure,
} from "@/modules/harness/lib/harness/piClient";
import {
  cancelTurn,
  compactContext,
  forgetSession,
  respondApproval,
  respondQuestion,
  sendTurn,
  setPiBinaryResolver,
  steerTurn,
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
type Case = {
  label: string;
  flavor: PiFlavor;
  method: "confirm" | "select" | "input" | "editor";
};
const cases: Case[] = [
  { label: "pi confirm", flavor: PI_FLAVOR, method: "confirm" },
  { label: "pi select", flavor: PI_FLAVOR, method: "select" },
  { label: "omp confirm", flavor: OMP_FLAVOR, method: "confirm" },
  { label: "omp select", flavor: OMP_FLAVOR, method: "select" },
  { label: "omp input", flavor: OMP_FLAVOR, method: "input" },
  { label: "omp editor", flavor: OMP_FLAVOR, method: "editor" },
];
const requests: Request[] = [];
const spawns: string[] = [];
const kills: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let release: (() => void) | undefined;
let autoPrompt = true;
let intercept: ((request: Request) => Promise<void> | undefined) | undefined;
const outstanding: {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}[] = [];
function observed<T extends Promise<unknown>>(promise: T): T {
  void promise.catch(() => undefined);
  return promise;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = observed(
    new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  const held = { promise, resolve, reject };
  outstanding.push(held);
  return held;
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function frame(nativeId: string, value: Record<string, unknown>) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: nativeId, line: JSON.stringify(value) },
  });
}
function reply(request: Request) {
  frame(request.nativeId, {
    type: "response",
    command: request.command.type,
    id: request.command.id,
    success: true,
    data:
      request.command.type === "get_state"
        ? { sessionId: `provider_${request.nativeId}` }
        : {},
  });
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  sessionId = "ui-writer",
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:default`,
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => {
      events.push(event);
      if (event.type === "approval.requested")
        respondApproval(flavor, sessionId, event.requestId, "allow");
      if (event.type === "question.asked")
        respondQuestion(flavor, sessionId, event.requestId, {
          kind: "answered",
          answers: { [event.questions[0].id]: ["0"] },
          custom: { [event.questions[0].id]: "user value" },
        });
    },
  };
}
async function active(test: Case) {
  autoPrompt = true;
  await sendTurn(test.flavor, input(test.flavor));
  autoPrompt = false;
  const events: HarnessEvent[] = [];
  let failure: unknown;
  const turn = observed(sendTurn(test.flavor, input(test.flavor, events)));
  void turn.catch((error) => {
    failure = error;
  });
  await flush();
  const nativeId = spawns[spawns.length - 1];
  if (!nativeId) throw new Error("Expected active actor");
  return { turn, events, nativeId, failure: () => failure };
}
function ask(test: Case, nativeId: string, id = "ui") {
  frame(nativeId, {
    type: "extension_ui_request",
    id,
    method: test.method,
    title: "Local request",
    options: ["original choice"],
  });
}
function holdUi() {
  const held = deferred();
  intercept = (request) =>
    request.command.type === "extension_ui_response" ? held.promise : undefined;
  return held;
}
function uiWrites() {
  return requests.filter(
    (request) => request.command.type === "extension_ui_response",
  );
}
function fresh(
  test: Case,
  kind: "prompt" | "compact",
  events: HarnessEvent[] = [],
) {
  return kind === "prompt"
    ? sendTurn(test.flavor, input(test.flavor, events))
    : compactContext(test.flavor, input(test.flavor, events));
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
      if (command === "harness_kill") kills.push(nativeId);
      if (command === "harness_write") {
        const request = {
          nativeId,
          command: JSON.parse(String(args.line)) as Record<string, unknown>,
        };
        requests.push(request);
        const held = intercept?.(request);
        if (held) {
          await held;
          return undefined as T;
        }
        if (request.command.type === "extension_ui_response")
          return undefined as T;
        reply(request);
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
  requests.length = 0;
  spawns.length = 0;
  kills.length = 0;
  autoPrompt = true;
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const held of outstanding.splice(0)) held.resolve();
  await flush();
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const sid of ["ui-writer", "sibling"])
      await forgetSession(flavor, sid);
  await flush();
});
describe.each(cases)("$label captured actual UI writer", (test) => {
  it("observes physical failure after the owning UI resolution and preserves error identity", async () => {
    const current = await active(test);
    const held = holdUi();
    ask(test, current.nativeId);
    await flush();
    expect(
      current.events.filter(
        (event) =>
          event.type === "approval.resolved" ||
          event.type === "question.resolved",
      ),
    ).toHaveLength(1);
    expect(uiWrites()).toHaveLength(1);
    const error = new Error("UI pipe rejected");
    held.reject(error);
    await flush();
    expect(current.failure()).toBe(error);
    await expect(current.turn).rejects.toBe(error);
    await expect(sendTurn(test.flavor, input(test.flavor))).rejects.toBe(error);
    expect(spawns).toHaveLength(1);
    expect(kills).toHaveLength(0);
  });
  it("does not retroactively reject a completed call but blocks subsequent native reuse", async () => {
    const current = await active(test);
    const held = holdUi();
    ask(test, current.nativeId);
    await flush();
    frame(current.nativeId, { type: "agent_settled" });
    await current.turn;
    const error = new Error("late physical failure");
    held.reject(error);
    await flush();
    expect(current.failure()).toBeUndefined();
    autoPrompt = true;
    await expect(sendTurn(test.flavor, input(test.flavor))).rejects.toBe(error);
    expect(spawns).toHaveLength(1);
  });
  for (const kind of ["prompt", "compact"] as const) {
    it(`drains an eligible cancelled-generation UI writer before new ${kind}`, async () => {
      const current = await active(test);
      const held = holdUi();
      ask(test, current.nativeId);
      await flush();
      await cancelTurn(test.flavor, "ui-writer");
      await current.turn;
      autoPrompt = true;
      const count = requests.length;
      const next = observed(fresh(test, kind));
      await flush();
      expect(requests).toHaveLength(count);
      held.resolve();
      await next;
      expect(requests.length).toBeGreaterThan(count);
      expect(spawns).toHaveLength(1);
    });
    it(`blocks waiting ${kind} with the first physical UI error before any new RPC`, async () => {
      const current = await active(test);
      const held = holdUi();
      ask(test, current.nativeId);
      await flush();
      await cancelTurn(test.flavor, "ui-writer");
      await current.turn;
      autoPrompt = true;
      const count = requests.length;
      const next = observed(fresh(test, kind));
      await flush();
      expect(requests).toHaveLength(count);
      const error = new Error("retired-generation UI write failed");
      held.reject(error);
      await expect(next).rejects.toBe(error);
      expect(requests).toHaveLength(count);
    });
  }
  it("never poisons a replacement with an old captured native UI failure", async () => {
    const current = await active(test);
    const held = holdUi();
    ask(test, current.nativeId);
    await flush();
    await stopSession(test.flavor, "ui-writer");
    await current.turn;
    autoPrompt = true;
    await sendTurn(test.flavor, input(test.flavor));
    held.reject(new Error("old actor failed"));
    await flush();
    await sendTurn(test.flavor, input(test.flavor));
    expect(spawns).toHaveLength(2);
  });
  it("leaves a warmed other-flavor sibling usable", async () => {
    const sibling = test.flavor.id === "pi" ? OMP_FLAVOR : PI_FLAVOR;
    await sendTurn(sibling, input(sibling, [], "sibling"));
    const current = await active(test);
    const held = holdUi();
    ask(test, current.nativeId);
    await flush();
    const error = new Error("only original actor");
    held.reject(error);
    await flush();
    expect(current.failure()).toBe(error);
    autoPrompt = true;
    await sendTurn(sibling, input(sibling, [], "sibling"));
    await expect(sendTurn(test.flavor, input(test.flavor))).rejects.toBe(error);
    expect(spawns).toHaveLength(2);
  });
  it("normalizes non-Error physical failures using the existing actor barrier", async () => {
    const current = await active(test);
    const held = holdUi();
    ask(test, current.nativeId);
    await flush();
    held.reject("opaque pipe failure");
    await flush();
    expect(current.failure()).toBeInstanceOf(Error);
    expect((current.failure() as Error).message).toBe("opaque pipe failure");
    await expect(sendTurn(test.flavor, input(test.flavor))).rejects.toBe(
      current.failure(),
    );
  });
  it("preserves the first original error across two actual failures", async () => {
    const current = await active(test);
    const first = deferred();
    const second = deferred();
    let n = 0;
    intercept = (request) =>
      request.command.type === "extension_ui_response"
        ? ++n === 1
          ? first.promise
          : second.promise
        : undefined;
    ask(test, current.nativeId, "first");
    ask(test, current.nativeId, "second");
    await flush();
    const original = new Error("first UI error");
    first.reject(original);
    await flush();
    second.reject(new Error("second UI error"));
    await flush();
    expect(current.failure()).toBe(original);
    await expect(sendTurn(test.flavor, input(test.flavor))).rejects.toBe(
      original,
    );
  });
});
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id UI writer shared accounting",
  (flavor) => {
    const test: Case = { label: flavor.id, flavor, method: "confirm" };
    it("counts 256 UI writers and refuses the 257th before any physical write", async () => {
      const current = await active(test);
      const held = holdUi();
      for (let i = 0; i < 256; i++) {
        ask(test, current.nativeId, `ui_${i}`);
        await flush();
      }
      expect(uiWrites()).toHaveLength(256);
      ask(test, current.nativeId, "overquota");
      await flush();
      expect(uiWrites()).toHaveLength(256);
      expect((current.failure() as Error)?.message).toBe(
        "Pi RPC writer capacity exceeded",
      );
      held.resolve();
      await flush();
    });
    it("shares one capacity with an ACKed but physically held RPC writer", async () => {
      const current = await active(test);
      const held = deferred();
      intercept = (request) => {
        if (request.command.type === "extension_ui_response")
          return held.promise;
        if (request.command.type === "steer") {
          reply(request);
          return held.promise;
        }
      };
      const steering = observed(
        steerTurn(flavor, { ...input(flavor), text: "steer" }),
      );
      await steering;
      for (let i = 0; i < 255; i++) {
        ask(test, current.nativeId, `ui_${i}`);
        await flush();
      }
      expect(uiWrites()).toHaveLength(255);
      ask(test, current.nativeId, "overquota");
      await flush();
      expect(uiWrites()).toHaveLength(255);
      expect((current.failure() as Error)?.message).toBe(
        "Pi RPC writer capacity exceeded",
      );
      held.resolve();
    });
    it("retains retired UI writer capacity until actual finally frees a slot", async () => {
      const current = await active(test);
      const held = holdUi();
      for (let i = 0; i < 256; i++) {
        ask(test, current.nativeId, `ui_${i}`);
        await flush();
      }
      await stopSession(flavor, "ui-writer");
      await current.turn;
      autoPrompt = true;
      await expect(sendTurn(flavor, input(flavor))).rejects.toThrow(
        "Pi RPC writer capacity exceeded",
      );
      held.resolve();
      await flush();
      await expect(sendTurn(flavor, input(flavor))).rejects.toThrow(
        "Pi RPC writer capacity exceeded",
      );
      await stopSession(flavor, "ui-writer");
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(3);
    });
    it("observes a cancelled-entry denial failure without changing its non-draining eligibility", async () => {
      const current = await active(test);
      await cancelTurn(flavor, "ui-writer");
      await current.turn;
      const held = holdUi();
      ask(test, current.nativeId);
      await flush();
      expect(uiWrites()[0]?.command).toMatchObject({ cancelled: true });
      autoPrompt = true;
      await sendTurn(flavor, input(flavor));
      const error = new Error("cancelled denial pipe failed");
      held.reject(error);
      await flush();
      await expect(sendTurn(flavor, input(flavor))).rejects.toBe(error);
    });
    it("removes old command-failure provenance from an actual UI writer error", async () => {
      const current = await active(test);
      const held = holdUi();
      ask(test, current.nativeId);
      await flush();
      const error = createPiRpcCommandFailure("previous command brand");
      expect(isPiRpcCommandFailure(error)).toBe(true);
      held.reject(error);
      await flush();
      expect(current.failure()).toBe(error);
      expect(isPiRpcCommandFailure(error)).toBe(false);
      await expect(sendTurn(flavor, input(flavor))).rejects.toBe(error);
    });
  },
);
