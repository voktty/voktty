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
  cancelTurn,
  compactContext,
  forgetSession,
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
const spawns: Record<string, unknown>[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const pids = new Map<string, number>();
let nextPid = 100;
let release: (() => void) | undefined;
let intercept: ((request: Request) => boolean) | undefined;
let autoPrompt = true;
function observed<T extends Promise<unknown>>(promise: T): T {
  void promise.catch(() => undefined);
  return promise;
}
async function flush(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function frame(nativeId: string, value: Record<string, unknown>): void {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: nativeId, line: JSON.stringify(value) },
  });
}
function reply(request: Request, data: unknown = {}): void {
  frame(request.nativeId, {
    type: "response",
    id: request.command.id,
    command: request.command.type,
    success: true,
    data,
  });
}
function required(request: Request | undefined): Request {
  if (!request) throw new Error("Expected captured native request");
  return request;
}
function nativeId(): string {
  const spawn = spawns[spawns.length - 1];
  if (!spawn) throw new Error("Expected native spawn");
  return String(spawn.sessionId);
}
function commands(type: string): Request[] {
  return requests.filter((request) => request.command.type === type);
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  text = "hello",
): SendTurnInput {
  return {
    sessionId: "control-pi",
    cwd: "/repo",
    model: `${flavor.id}:default`,
    modelSettings: { thinking: "off" },
    runtimeMode: "supervised",
    text,
    onEvent: (event) => events.push(event),
  };
}
function hold(type: string): () => Request {
  let captured: Request | undefined;
  intercept = (request) => {
    if (request.command.type !== type) return false;
    captured = request;
    return true;
  };
  return () => required(captured);
}
beforeAll(async () => {
  child.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      const id = String(args.sessionId);
      if (command === "harness_spawn") {
        spawns.push(args);
        const pid = nextPid++;
        pids.set(id, pid);
        return pid as T;
      }
      if (command === "harness_write") {
        const request = {
          nativeId: id,
          command: JSON.parse(String(args.line)) as Record<string, unknown>,
        };
        requests.push(request);
        if (intercept?.(request)) return undefined as T;
        reply(
          request,
          request.command.type === "get_state"
            ? { sessionId: `provider_${id}`, thinkingLevel: "off" }
            : request.command.type === "get_fork_messages"
              ? { messages: [{ entryId: "entry", text: "previous" }] }
              : request.command.type === "compact"
                ? { estimatedTokensAfter: 42 }
                : {},
        );
        if (request.command.type === "prompt" && autoPrompt)
          frame(id, { type: "agent_settled" });
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
  intercept = undefined;
  autoPrompt = true;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR]) {
    await forgetSession(flavor, "control-pi");
    await forgetSession(flavor, "mutated");
  }
});

describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id fixed control operations",
  (flavor) => {
    it.each(["get_fork_messages", "fork", "get_state"])(
      "retires a rewind held at %s on the same native child",
      async (type) => {
        const events: HarnessEvent[] = [];
        await observed(sendTurn(flavor, input(flavor)));
        const captured = hold(type);
        const action = observed(rewindLastTurn(flavor, input(flavor, events)));
        await flush();
        const old = captured();
        const count = requests.length;
        await cancelTurn(flavor, "control-pi");
        intercept = undefined;
        reply(
          old,
          type === "get_fork_messages"
            ? { messages: [{ entryId: "old", text: "previous" }] }
            : type === "get_state"
              ? { sessionId: "cancelled-fork" }
              : {},
        );
        await expect(action).rejects.toThrow(/retired/i);
        expect(
          requests.slice(count).map((request) => request.command.type),
        ).toEqual(["abort"]);
        expect(
          events.filter((event) => event.type === "session.providerBound"),
        ).toEqual([]);
        expect(spawns).toHaveLength(1);
      },
    );

    it("classifies a failed old rewind reply by its captured generation", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const captured = hold("get_fork_messages");
      const action = observed(rewindLastTurn(flavor, input(flavor)));
      await flush();
      await cancelTurn(flavor, "control-pi");
      const old = captured();
      frame(old.nativeId, {
        type: "response",
        id: old.command.id,
        command: "get_fork_messages",
        success: false,
        error: "old command failed",
      });
      await expect(action).rejects.toThrow(/retired/i);
    });

    it.each(["compact", "rewind"])(
      "captures the warm %s generation before the admission await",
      async (kind) => {
        await observed(sendTurn(flavor, input(flavor)));
        const count = requests.length;
        const action = observed(
          kind === "compact"
            ? compactContext(flavor, input(flavor))
            : rewindLastTurn(flavor, input(flavor)),
        );
        await cancelTurn(flavor, "control-pi");
        await expect(action).rejects.toThrow(/retired/i);
        expect(
          requests.slice(count).map((request) => request.command.type),
        ).toEqual(["abort"]);
      },
    );

    it("suppresses a cancelled compact response while a fresh turn drains its FIFO", async () => {
      const events: HarnessEvent[] = [];
      await observed(sendTurn(flavor, input(flavor)));
      const captured = hold("compact");
      const action = observed(compactContext(flavor, input(flavor, events)));
      await flush();
      const old = captured();
      await cancelTurn(flavor, "control-pi");
      const fresh = observed(sendTurn(flavor, input(flavor, [], "fresh")));
      await flush();
      expect(commands("prompt")).toHaveLength(1);
      intercept = undefined;
      reply(old, { estimatedTokensAfter: 999 });
      await expect(action).rejects.toThrow(/retired/i);
      await fresh;
      expect(
        events.filter(
          (event) => event.type === "context" && event.used === 999,
        ),
      ).toEqual([]);
      expect(commands("prompt")).toHaveLength(2);
      expect(spawns).toHaveLength(1);
    });

    it("queues compact configuration and its captured event sink behind the active turn", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      autoPrompt = false;
      const firstEvents: HarnessEvent[] = [];
      const compactEvents: HarnessEvent[] = [];
      const mutatedEvents: HarnessEvent[] = [];
      const first = observed(
        sendTurn(flavor, input(flavor, firstEvents, "first")),
      );
      await flush();
      const request = input(flavor, compactEvents);
      request.model = `${flavor.id}:anthropic/captured`;
      const action = observed(compactContext(flavor, request));
      request.model = `${flavor.id}:anthropic/mutated`;
      request.onEvent = (event) => mutatedEvents.push(event);
      await flush();
      expect(commands("set_model")).toEqual([]);
      frame(nativeId(), {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "first output" },
      });
      expect(firstEvents).toContainEqual({
        type: "message.delta",
        text: "first output",
      });
      expect(
        compactEvents.filter((event) => event.type === "message.delta"),
      ).toEqual([]);
      frame(nativeId(), { type: "agent_settled" });
      await first;
      await action;
      expect(
        commands("set_model").map((request) => request.command.modelId),
      ).toEqual(["captured"]);
      expect(compactEvents).toContainEqual({ type: "context", used: 42 });
      expect(mutatedEvents).toEqual([]);
    });

    it("captures rewind binding identity and callbacks before its admission await", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const capturedEvents: HarnessEvent[] = [];
      const mutatedEvents: HarnessEvent[] = [];
      intercept = (request) => {
        if (request.command.type !== "get_state") return false;
        reply(request, { sessionId: "captured-fork", thinkingLevel: "off" });
        return true;
      };
      const request = input(flavor, capturedEvents);
      const action = observed(rewindLastTurn(flavor, request));
      request.sessionId = "mutated";
      request.onEvent = (event) => mutatedEvents.push(event);
      await action;
      expect(capturedEvents).toContainEqual({
        type: "session.providerBound",
        providerSessionId: "captured-fork",
      });
      expect(mutatedEvents).toEqual([]);
      intercept = undefined;
      await stopSession(flavor, "control-pi");
      await observed(sendTurn(flavor, input(flavor)));
      expect(spawns[1]?.args).toContain("captured-fork");
    });

    it("holds fresh work until a cancelled same-child steer reply retires", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      autoPrompt = false;
      const first = observed(sendTurn(flavor, input(flavor)));
      await flush();
      const captured = hold("steer");
      const action = observed(steerTurn(flavor, input(flavor, [], "steering")));
      await flush();
      const old = captured();
      await cancelTurn(flavor, "control-pi");
      await first;
      intercept = undefined;
      autoPrompt = true;
      const count = requests.length;
      const fresh = observed(sendTurn(flavor, input(flavor, [], "fresh")));
      await flush();
      expect(requests).toHaveLength(count);
      reply(old);
      await expect(action).rejects.toThrow(/retired/i);
      await fresh;
      expect(spawns).toHaveLength(1);
    });

    it.each(["compact", "rewind"])(
      "revalidates %s after a callback cancels its generation",
      async (kind) => {
        await observed(sendTurn(flavor, input(flavor)));
        let cancellation: Promise<void> | undefined;
        const request = input(flavor);
        request.onEvent = (event) => {
          if (
            event.type ===
            (kind === "compact" ? "context" : "session.providerBound")
          )
            cancellation = observed(cancelTurn(flavor, "control-pi"));
        };
        const action = observed(
          kind === "compact"
            ? compactContext(flavor, request)
            : rewindLastTurn(flavor, request),
        );
        await expect(action).rejects.toThrow(/retired/i);
        if (!cancellation)
          throw new Error("Expected cancelling control callback");
        await cancellation;
      },
    );

    it("queues rewind behind compact without publishing obsolete queries after cancellation", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const captured = hold("compact");
      const compact = observed(compactContext(flavor, input(flavor)));
      await flush();
      const old = captured();
      const rewind = observed(rewindLastTurn(flavor, input(flavor)));
      await flush();
      expect(commands("get_fork_messages")).toEqual([]);
      await cancelTurn(flavor, "control-pi");
      intercept = undefined;
      reply(old, { estimatedTokensAfter: 77 });
      await expect(compact).rejects.toThrow(/retired/i);
      await expect(rewind).rejects.toThrow(/retired/i);
      expect(commands("get_fork_messages")).toEqual([]);
      await observed(sendTurn(flavor, input(flavor, [], "fresh")));
    });

    it.each(["compact", "rewind", "steer"])(
      "guards the %s caller continuation after its helper already fulfilled",
      async (kind) => {
        await observed(sendTurn(flavor, input(flavor)));
        let active: Promise<void> | undefined;
        if (kind === "steer") {
          autoPrompt = false;
          active = observed(sendTurn(flavor, input(flavor)));
          await flush();
        }
        const events: HarnessEvent[] = [];
        const captured = hold(kind === "rewind" ? "get_state" : kind);
        const request = input(flavor, events, "steering");
        const action = observed(
          kind === "compact"
            ? compactContext(flavor, request)
            : kind === "rewind"
              ? rewindLastTurn(flavor, request)
              : steerTurn(flavor, request),
        );
        await flush();
        reply(
          captured(),
          kind === "compact"
            ? { estimatedTokensAfter: 777 }
            : kind === "rewind"
              ? { sessionId: "microtask-fork" }
              : {},
        );
        const cancellation = observed(
          Promise.resolve().then(() =>
            Promise.resolve().then(() => cancelTurn(flavor, "control-pi")),
          ),
        );
        await expect(action).rejects.toThrow(/retired/i);
        await cancellation;
        await active;
        expect(
          events.filter(
            (event) =>
              event.type === "context" ||
              event.type === "session.providerBound",
          ),
        ).toEqual([]);
        if (kind === "rewind") {
          intercept = undefined;
          await stopSession(flavor, "control-pi");
          await observed(sendTurn(flavor, input(flavor)));
          expect(spawns[1]?.args).not.toContain("microtask-fork");
        }
      },
    );

    it("checks the rewind caller token before parsing an already-fulfilled malformed reply", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const captured = hold("get_fork_messages");
      const action = observed(rewindLastTurn(flavor, input(flavor)));
      await flush();
      reply(captured(), { messages: [] });
      const cancellation = observed(
        Promise.resolve().then(() =>
          Promise.resolve().then(() => cancelTurn(flavor, "control-pi")),
        ),
      );
      await expect(action).rejects.toThrow(/retired/i);
      await cancellation;
    });

    it.each(["set_model", "set_thinking_level"])(
      "cannot cache a %s reply after its helper fulfilled but the caller was cancelled",
      async (type) => {
        await observed(sendTurn(flavor, input(flavor)));
        requests.length = 0;
        const captured = hold(type);
        const request = input(flavor);
        if (type === "set_model")
          request.model = `${flavor.id}:anthropic/captured`;
        else request.modelSettings = { thinking: "high" };
        const action = observed(sendTurn(flavor, request));
        await flush();
        reply(captured());
        const cancellation = observed(
          Promise.resolve().then(() =>
            Promise.resolve().then(() => cancelTurn(flavor, "control-pi")),
          ),
        );
        await action;
        await cancellation;
        intercept = undefined;
        await observed(sendTurn(flavor, request));
        expect(commands(type)).toHaveLength(2);
      },
    );

    it("preserves the original error from a current positive-PID native exit", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      hold("compact");
      const action = observed(compactContext(flavor, input(flavor)));
      await flush();
      const id = nativeId();
      const pid = pids.get(id);
      if (!pid) throw new Error("Expected positive native PID");
      listeners.get("harness-exit")?.({
        payload: { sessionId: id, pid, code: 7 },
      });
      await expect(action).rejects.toThrow(`${flavor.label} exited`);
    });
  },
);
