import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import * as child from "./child";
import {
  bindSession,
  cancelTurn,
  compactContext,
  forgetSession,
  ompCommandProvider,
  rewindLastTurn,
  sendTurn,
  setPiBinaryResolver,
  steerTurn,
  stopSession,
} from "./piFamily";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import type { HarnessEvent, SendTurnInput } from "./types";

type Request = { nativeId: string; command: Record<string, unknown> };
const requests: Request[] = [];
const spawns: string[] = [];
const spawnInputs: Record<string, unknown>[] = [];
const kills: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let release: (() => void) | undefined;
let intercept: ((request: Request) => Promise<void> | undefined) | undefined;
let autoPrompt = true;
function observed<T extends Promise<unknown>>(promise: T): T {
  void promise.catch(() => undefined);
  return promise;
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  observed(promise);
  return { promise, resolve, reject };
}
function frame(nativeId: string, value: Record<string, unknown>) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: nativeId, line: JSON.stringify(value) },
  });
}
function reply(request: Request, success = true, error?: string) {
  frame(request.nativeId, {
    type: "response",
    id: request.command.id,
    command: request.command.type,
    success,
    error,
    data:
      request.command.type === "get_state"
        ? { sessionId: `provider_${request.nativeId}`, thinkingLevel: "off" }
        : request.command.type === "get_fork_messages"
          ? { messages: [{ entryId: "entry", text: "previous" }] }
          : request.command.type === "get_available_commands"
            ? { commands: [] }
            : {},
  });
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  sessionId = "late-writer",
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:default`,
    modelSettings: { thinking: "off" },
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => events.push(event),
  };
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
        spawnInputs.push(args);
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
  spawnInputs.length = 0;
  kills.length = 0;
  intercept = undefined;
  autoPrompt = true;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["late-writer", "sibling"])
      await forgetSession(flavor, id);
});
async function expectBlocked(flavor: PiFlavor, original: Error) {
  const count = requests.length;
  await expect(sendTurn(flavor, input(flavor))).rejects.toBe(original);
  await expect(compactContext(flavor, input(flavor))).rejects.toBe(original);
  await expect(rewindLastTurn(flavor, input(flavor))).rejects.toBe(original);
  expect(requests).toHaveLength(count);
  expect(kills).toHaveLength(0);
}
async function issue(flavor: PiFlavor, type: string) {
  const request = input(flavor);
  if (type === "set_model") request.model = `${flavor.id}:anthropic/selected`;
  if (type === "set_thinking_level")
    request.modelSettings = { thinking: "high" };
  if (type === "set_fast_mode")
    request.modelSettings = { thinking: "off", fast: "true" };
  if (type === "compact") await compactContext(flavor, request);
  else if (type === "get_fork_messages" || type === "fork")
    await rewindLastTurn(flavor, request);
  else if (type === "abort") await cancelTurn(flavor, request.sessionId);
  else if (type === "get_available_commands")
    await ompCommandProvider.discover({
      sessionId: request.sessionId,
      cwd: request.cwd,
    });
  else await sendTurn(flavor, request);
}
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id late captured writer failure",
  (flavor) => {
    it.each([
      "get_state",
      "set_model",
      "set_thinking_level",
      "compact",
      "get_fork_messages",
      "fork",
      "prompt",
      "get_session_stats",
      "abort",
    ])(
      "blocks exact actor when %s writer rejects after its successful ACK",
      async (type) => {
        if (type !== "get_state") await sendTurn(flavor, input(flavor));
        const held = deferred();
        intercept = (request) => {
          if (request.command.type !== type) return;
          reply(request);
          if (type === "prompt")
            frame(request.nativeId, { type: "agent_settled" });
          return held.promise;
        };
        await issue(flavor, type);
        expect(requests.some((row) => row.command.type === type)).toBe(true);
        const original = new Error(`late ${type} write failure`);
        held.reject(original);
        await flush();
        await expectBlocked(flavor, original);
        expect(spawns).toHaveLength(1);
      },
    );

    it("retains the resumed actor after acknowledged startup writer fails late", async () => {
      bindSession(flavor, "late-writer", "saved_resume", "/repo");
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "get_state") return;
        reply(request);
        return held.promise;
      };
      await sendTurn(flavor, input(flavor));
      expect(spawnInputs[0]?.args).toContain("saved_resume");
      const original = new Error("late acknowledged resume writer failure");
      held.reject(original);
      await flush();
      await expectBlocked(flavor, original);
      expect(spawns).toHaveLength(1);
    });

    it("blocks after prompt finalizer removed an unacknowledged request", async () => {
      await sendTurn(flavor, input(flavor));
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "prompt") return;
        frame(request.nativeId, { type: "agent_settled" });
        return held.promise;
      };
      await sendTurn(flavor, input(flavor));
      const original = new Error("writer failed after local finalizer");
      held.reject(original);
      await flush();
      await expectBlocked(flavor, original);
    });

    it("blocks newer same-native work after cancelled old steer writer failed", async () => {
      await sendTurn(flavor, input(flavor));
      autoPrompt = false;
      const active = observed(sendTurn(flavor, input(flavor)));
      await flush();
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "steer") return;
        reply(request);
        return held.promise;
      };
      await steerTurn(flavor, { ...input(flavor), text: "guide" });
      await cancelTurn(flavor, "late-writer");
      await active;
      autoPrompt = true;
      await sendTurn(flavor, input(flavor));
      const original = new Error("old steer writer failed after newer turn");
      held.reject(original);
      await flush();
      await expectBlocked(flavor, original);
      expect(spawns).toHaveLength(1);
    });

    it.each([PI_FLAVOR, OMP_FLAVOR])(
      "does not poison $id replacement after old acknowledged writer rejects",
      async (replacement) => {
        await sendTurn(flavor, input(flavor));
        const held = deferred();
        let oldId = "";
        intercept = (request) => {
          if (request.command.type !== "compact") return;
          oldId = request.nativeId;
          reply(request);
          return held.promise;
        };
        await compactContext(flavor, input(flavor));
        await stopSession(flavor, "late-writer");
        intercept = undefined;
        await sendTurn(replacement, input(replacement));
        held.reject(new Error("old native writer failed"));
        await flush();
        await sendTurn(replacement, input(replacement));
        expect(spawns).toHaveLength(2);
        expect(spawns[1]).not.toBe(oldId);
      },
    );

    it("does not classify late successful write completion as uncertainty", async () => {
      await sendTurn(flavor, input(flavor));
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return held.promise;
      };
      await compactContext(flavor, input(flavor));
      held.resolve();
      await flush();
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(1);
      expect(kills).toHaveLength(0);
    });

    it("retains first late writer error and does not block another logical actor", async () => {
      await sendTurn(flavor, input(flavor));
      await sendTurn(flavor, input(flavor, [], "sibling"));
      const first = deferred();
      const second = deferred();
      let count = 0;
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return count++ === 0 ? first.promise : second.promise;
      };
      await compactContext(flavor, input(flavor));
      await compactContext(flavor, input(flavor));
      const original = new Error("first late write");
      first.reject(original);
      await flush();
      second.reject(new Error("second late write"));
      await flush();
      await expectBlocked(flavor, original);
      await sendTurn(flavor, input(flavor, [], "sibling"));
      expect(spawns).toHaveLength(2);
    });

    it("normalizes a late primitive failure once for subsequent actor operations", async () => {
      await sendTurn(flavor, input(flavor));
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return held.promise;
      };
      await compactContext(flavor, input(flavor));
      held.reject("late primitive writer failure");
      await flush();
      const error: unknown = await sendTurn(flavor, input(flavor)).catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty("message", "late primitive writer failure");
      if (!(error instanceof Error))
        throw new Error("Expected captured normalized Error");
      await expectBlocked(flavor, error);
    });

    it("settles a fresh active same-native turn when an old ACKed writer fails", async () => {
      await sendTurn(flavor, input(flavor));
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return held.promise;
      };
      await compactContext(flavor, input(flavor));
      autoPrompt = false;
      const fresh = observed(sendTurn(flavor, input(flavor)));
      await flush();
      const original = new Error("old writer failed during fresh active turn");
      held.reject(original);
      await flush();
      frame(spawns[0], { type: "agent_settled" });
      await expect(fresh).rejects.toBe(original);
      await expectBlocked(flavor, original);
    });

    it("blocks a late writer failure after a known negative command ACK", async () => {
      await sendTurn(flavor, input(flavor));
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request, false, "known command rejection");
        return held.promise;
      };
      await expect(compactContext(flavor, input(flavor))).rejects.toThrow(
        "known command rejection",
      );
      const original = new Error("late writer failure after command NACK");
      held.reject(original);
      await flush();
      await expectBlocked(flavor, original);
    });

    it("still handles exact native exit after late-writer poisoning", async () => {
      const events: HarnessEvent[] = [];
      await sendTurn(flavor, input(flavor, events));
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return held.promise;
      };
      await compactContext(flavor, input(flavor, events));
      const original = new Error("late failure before native exit");
      held.reject(original);
      await flush();
      await expectBlocked(flavor, original);
      listeners.get("harness-exit")?.({
        payload: { sessionId: spawns[0], pid: 123, code: 13 },
      });
      await flush();
      expect(
        events.filter((event) => event.type === "session.ended"),
      ).toHaveLength(1);
      intercept = undefined;
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(2);
    });
  },
);
describe("omp auxiliary RPC writer failures", () => {
  it.each(["set_fast_mode", "get_available_commands"])(
    "blocks after acknowledged %s writer rejects late",
    async (type) => {
      await sendTurn(OMP_FLAVOR, input(OMP_FLAVOR));
      const held = deferred();
      intercept = (request) => {
        if (request.command.type !== type) return;
        reply(request);
        return held.promise;
      };
      await issue(OMP_FLAVOR, type);
      const original = new Error(`late ${type} writer`);
      held.reject(original);
      await flush();
      await expectBlocked(OMP_FLAVOR, original);
    },
  );
});
