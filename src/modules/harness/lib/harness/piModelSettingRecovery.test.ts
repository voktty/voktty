import * as child from "@/modules/harness/lib/harness/child";
import {
  cancelTurn,
  compactContext,
  forgetSession,
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
type State = { model: string; thinking: string; fast: boolean };
const BASE = "alpha/original";
const CHANGED = "beta/new-model";
const states = new Map<string, State>();
const requests: Request[] = [];
const executions: { nativeId: string; type: unknown; state: State }[] = [];
const spawns: string[] = [];
const kills: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let intercept: ((request: Request) => boolean) | undefined;
let resetFast = false;
let resetThinking = "off";
let release: (() => void) | undefined;
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
function reply(request: Request, success = true) {
  const state = states.get(request.nativeId);
  if (!state) throw new Error("Expected owned native configuration");
  if (success && request.command.type === "set_model") {
    state.model = `${request.command.provider}/${request.command.modelId}`;
    state.thinking = resetThinking;
    state.fast = resetFast;
  }
  if (success && request.command.type === "set_thinking_level")
    state.thinking = String(request.command.level);
  if (success && request.command.type === "set_fast_mode")
    state.fast = request.command.enabled === true;
  const separator = state.model.indexOf("/");
  const model = {
    provider: state.model.slice(0, separator),
    id: state.model.slice(separator + 1),
    contextWindow: 8192,
  };
  frame(request.nativeId, {
    type: "response",
    id: request.command.id,
    command: request.command.type,
    success,
    error: success ? undefined : "setting rejected",
    data:
      request.command.type === "get_state"
        ? {
            sessionId: `provider_${request.nativeId}`,
            model,
            thinkingLevel: state.thinking,
            fastModeEnabled: state.fast,
          }
        : request.command.type === "set_model"
          ? model
          : request.command.type === "set_fast_mode"
            ? { enabled: state.fast }
            : {},
  });
}
function input(
  flavor: PiFlavor,
  model = BASE,
  thinking = "high",
  fast = true,
  sessionId = "model-settings",
  events: HarnessEvent[] = [],
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:${model}`,
    modelSettings: {
      thinking,
      ...(flavor.id === "omp" ? { fast: fast ? "true" : "false" } : {}),
    },
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => events.push(event),
  };
}
async function warm(
  flavor: PiFlavor,
  thinking = "high",
  fast = true,
  id = "model-settings",
) {
  await sendTurn(flavor, input(flavor, BASE, "low", true, id));
  await sendTurn(flavor, input(flavor, BASE, thinking, fast, id));
  resetFast = !fast;
  resetThinking = thinking === "off" ? "high" : "off";
}
function fresh(
  flavor: PiFlavor,
  kind: "prompt" | "compact",
  model = CHANGED,
  thinking = "high",
  fast = true,
) {
  const request = input(flavor, model, thinking, fast);
  return kind === "prompt"
    ? sendTurn(flavor, request)
    : compactContext(flavor, request);
}
function holdModel(type = "set_model") {
  let request: Request | undefined;
  intercept = (row) => {
    if (row.command.type !== type) return false;
    request = row;
    return true;
  };
  return () => {
    if (!request) throw new Error("Expected captured model setter");
    return request;
  };
}
function setters() {
  return requests.filter(
    (row) =>
      row.command.type === "set_thinking_level" ||
      row.command.type === "set_fast_mode",
  );
}
beforeAll(async () => {
  child.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      const nativeId = String(args.sessionId);
      if (command === "harness_spawn") {
        const argv = args.args as string[];
        const at = argv.indexOf("--model");
        states.set(nativeId, {
          model: at < 0 ? BASE : (argv[at + 1] ?? BASE),
          thinking: "high",
          fast: false,
        });
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
        if (intercept?.(request)) return undefined as T;
        if (
          request.command.type === "prompt" ||
          request.command.type === "compact"
        ) {
          const state = states.get(nativeId);
          if (!state) throw new Error("Expected native execution");
          executions.push({
            nativeId,
            type: request.command.type,
            state: { ...state },
          });
        }
        reply(request);
        if (request.command.type === "prompt")
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
  states.clear();
  requests.length = 0;
  executions.length = 0;
  spawns.length = 0;
  kills.length = 0;
  intercept = undefined;
  resetFast = false;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["model-settings", "sibling"])
      await forgetSession(flavor, id);
});
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id model-dependent explicit settings",
  (flavor) => {
    const configurations = ["off", "low", "high"].flatMap((thinking) =>
      (flavor.id === "omp" ? [true, false] : [true]).flatMap((fast) =>
        (["prompt", "compact"] as const).map((kind) => ({
          thinking,
          fast,
          kind,
        })),
      ),
    );
    it.each(configurations)(
      "restores effective $thinking fast=$fast before $kind after model ACK",
      async ({ thinking, fast, kind }) => {
        await warm(flavor, thinking, fast);
        const count = setters().length;
        await fresh(flavor, kind, CHANGED, thinking, fast);
        expect(executions[executions.length - 1]?.state).toMatchObject({
          model: CHANGED,
          thinking,
          ...(flavor.id === "omp" ? { fast } : {}),
        });
        expect(setters().length).toBeGreaterThan(count);
        expect(spawns).toHaveLength(1);
        expect(kills).toEqual([]);
        const healthy = setters().length;
        await fresh(flavor, kind, CHANGED, thinking, fast);
        expect(setters()).toHaveLength(healthy);
      },
    );
    it.each(
      flavor.id === "omp"
        ? ["set_thinking_level", "set_fast_mode"]
        : ["set_thinking_level"],
    )(
      "does not downgrade retired setter uncertainty on a later model ACK, %s",
      async (type) => {
        await warm(flavor);
        const captured = holdModel(type);
        const old = observed(
          sendTurn(
            flavor,
            input(
              flavor,
              BASE,
              type === "set_thinking_level" ? "low" : "high",
              false,
            ),
          ),
        );
        await flush();
        await cancelTurn(flavor, "model-settings");
        reply(captured());
        await old;
        intercept = undefined;
        const executed = executions.length;
        intercept = (request) => {
          if (request.command.type !== type) return false;
          reply(request, false);
          return true;
        };
        const error = await sendTurn(flavor, input(flavor, CHANGED)).then(
          () => undefined,
          (reason: unknown) => reason,
        );
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ message: "setting rejected" });
        const count = requests.length;
        await expect(sendTurn(flavor, input(flavor))).rejects.toBe(error);
        await expect(compactContext(flavor, input(flavor))).rejects.toBe(error);
        expect(requests).toHaveLength(count);
        expect(executions).toHaveLength(executed);
        expect(kills).toEqual([]);
      },
    );
    it.each([true, false])(
      "records dependent uncertainty before retirement guard on model response success=%s",
      async (success) => {
        await warm(flavor);
        const captured = holdModel();
        const old = observed(sendTurn(flavor, input(flavor, CHANGED)));
        await flush();
        await cancelTurn(flavor, "model-settings");
        reply(captured(), success);
        await old;
        intercept = undefined;
        const count = setters().length;
        await sendTurn(flavor, input(flavor, "default"));
        expect(executions[executions.length - 1]?.state).toMatchObject({
          model: success ? CHANGED : BASE,
          thinking: "high",
          ...(flavor.id === "omp" ? { fast: true } : {}),
        });
        expect(setters().length).toBe(
          success ? count + (flavor.id === "omp" ? 2 : 1) : count,
        );
      },
    );
    it("keeps dependent restoration across model helper/owning-caller cancellation gap", async () => {
      await warm(flavor);
      const captured = holdModel();
      const old = observed(sendTurn(flavor, input(flavor, CHANGED)));
      await flush();
      reply(captured());
      await Promise.resolve().then(() =>
        Promise.resolve().then(() => cancelTurn(flavor, "model-settings")),
      );
      await old;
      intercept = undefined;
      await sendTurn(flavor, input(flavor, "default"));
      expect(executions[executions.length - 1]?.state).toMatchObject({
        thinking: "high",
        ...(flavor.id === "omp" ? { fast: true } : {}),
      });
    });
    it("does not dirty settings when an ordinary model command is rejected", async () => {
      await warm(flavor);
      const count = setters().length;
      intercept = (request) => {
        if (request.command.type !== "set_model") return false;
        reply(request, false);
        return true;
      };
      await expect(sendTurn(flavor, input(flavor, CHANGED))).rejects.toThrow(
        "setting rejected",
      );
      intercept = undefined;
      await sendTurn(flavor, input(flavor));
      expect(setters()).toHaveLength(count);
      expect(kills).toEqual([]);
    });
    it("does not dirty a warmed sibling from A model uncertainty", async () => {
      await warm(flavor, "high", true, "sibling");
      await warm(flavor);
      const captured = holdModel();
      const old = observed(sendTurn(flavor, input(flavor, CHANGED)));
      await flush();
      await cancelTurn(flavor, "model-settings");
      reply(captured());
      await old;
      intercept = undefined;
      const count = setters().length;
      await sendTurn(flavor, input(flavor, BASE, "high", true, "sibling"));
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]).toMatchObject({
        nativeId: spawns[0],
        state: { thinking: "high" },
      });
    });
    it("does not dirty a replacement from an old captured model reply", async () => {
      await warm(flavor);
      const captured = holdModel();
      const old = observed(sendTurn(flavor, input(flavor, CHANGED)));
      await flush();
      await stopSession(flavor, "model-settings");
      await old;
      intercept = undefined;
      await warm(flavor);
      const count = setters().length;
      reply(captured());
      await flush();
      await sendTurn(flavor, input(flavor));
      expect(setters()).toHaveLength(count);
      expect(spawns).toHaveLength(2);
    });
    it("preserves ordinary confirmed thinking compatibility without a new model ACK", async () => {
      await warm(flavor, "low");
      intercept = (request) => {
        if (request.command.type !== "set_thinking_level") return false;
        reply(request, false);
        return true;
      };
      await sendTurn(flavor, input(flavor, BASE, "high"));
      expect(kills).toEqual([]);
      intercept = undefined;
      await sendTurn(flavor, input(flavor, BASE, "low"));
    });
    it("leaves uncertainty pending for omitted settings rather than clearing through model cache", async () => {
      await warm(flavor);
      const captured = holdModel();
      const old = observed(sendTurn(flavor, input(flavor, CHANGED)));
      await flush();
      await cancelTurn(flavor, "model-settings");
      reply(captured());
      await old;
      intercept = undefined;
      const omitted = input(flavor, "default");
      omitted.modelSettings = undefined;
      await sendTurn(flavor, omitted);
      await sendTurn(flavor, input(flavor, "default"));
      expect(executions[executions.length - 1]?.state).toMatchObject({
        thinking: "high",
        ...(flavor.id === "omp" ? { fast: true } : {}),
      });
    });
    it("preserves confirmed thinking rejection compatibility after model invalidation", async () => {
      await warm(flavor);
      let rejected = 0;
      intercept = (request) => {
        if (request.command.type !== "set_thinking_level") return false;
        rejected += 1;
        reply(request, false);
        return true;
      };
      await sendTurn(flavor, input(flavor, CHANGED));
      expect(rejected).toBe(1);
      expect(executions[executions.length - 1]?.state.thinking).toBe("off");
      await sendTurn(flavor, input(flavor, CHANGED));
      expect(rejected).toBe(1);
      expect(kills).toEqual([]);
    });
    it.each(
      flavor.id === "omp"
        ? ["set_thinking_level", "set_fast_mode"]
        : ["set_thinking_level"],
    )(
      "blocks uncertain model-invalidated %s write with the original error",
      async (type) => {
        await warm(flavor);
        const original = new Error("dependent write outcome unknown");
        const executed = executions.length;
        intercept = (request) => {
          if (request.command.type !== type) return false;
          throw original;
        };
        await expect(sendTurn(flavor, input(flavor, CHANGED))).rejects.toBe(
          original,
        );
        const count = requests.length;
        await expect(sendTurn(flavor, input(flavor))).rejects.toBe(original);
        await expect(compactContext(flavor, input(flavor))).rejects.toBe(
          original,
        );
        expect(requests).toHaveLength(count);
        expect(executions).toHaveLength(executed);
        expect(kills).toEqual([]);
      },
    );
    if (flavor.id === "omp") {
      it.each([true, false])(
        "preserves confirmed fast rejection compatibility after model invalidation, enabled=%s",
        async (fast) => {
          await warm(flavor, "high", fast);
          const events: HarnessEvent[] = [];
          let rejected = 0;
          intercept = (request) => {
            if (request.command.type !== "set_fast_mode") return false;
            rejected += 1;
            reply(request, false);
            return true;
          };
          await sendTurn(
            flavor,
            input(flavor, CHANGED, "high", fast, "model-settings", events),
          );
          expect(rejected).toBe(1);
          expect(executions[executions.length - 1]?.state).toMatchObject({
            model: CHANGED,
            thinking: "high",
            fast: !fast,
          });
          if (fast)
            expect(events).toContainEqual({
              type: "session.configChanged",
              modelSettings: { fast: "false" },
            });
          await sendTurn(flavor, input(flavor, CHANGED, "high", fast));
          expect(rejected).toBe(1);
          expect(kills).toEqual([]);
        },
      );
      it("keeps model invalidation pending when fast fallback callback cancels its owner", async () => {
        await warm(flavor);
        let cancelled: Promise<void> | undefined;
        intercept = (request) => {
          if (request.command.type !== "set_fast_mode") return false;
          reply(request, false);
          return true;
        };
        const next = input(flavor, CHANGED);
        next.onEvent = (event) => {
          if (event.type === "session.configChanged")
            cancelled = observed(cancelTurn(flavor, "model-settings"));
        };
        await sendTurn(flavor, next);
        expect(cancelled).toBeDefined();
        await cancelled;
        intercept = undefined;
        await sendTurn(flavor, input(flavor, "default"));
        expect(executions[executions.length - 1]?.state.fast).toBe(true);
      });
      it("preserves ordinary fast compatibility on an unchanged model", async () => {
        await warm(flavor, "high", false);
        const events: HarnessEvent[] = [];
        intercept = (request) => {
          if (request.command.type !== "set_fast_mode") return false;
          reply(request, false);
          return true;
        };
        await sendTurn(
          flavor,
          input(flavor, BASE, "high", true, "model-settings", events),
        );
        expect(events).toContainEqual({
          type: "session.configChanged",
          modelSettings: { fast: "false" },
        });
        expect(kills).toEqual([]);
      });
      it("does not clear dependent uncertainty through an untagged config frame", async () => {
        await warm(flavor);
        const captured = holdModel();
        const old = observed(sendTurn(flavor, input(flavor, CHANGED)));
        await flush();
        await cancelTurn(flavor, "model-settings");
        reply(captured());
        await old;
        intercept = undefined;
        frame(spawns[0] ?? "missing", {
          type: "config_update",
          thinkingLevel: "high",
          fastModeEnabled: true,
        });
        await sendTurn(flavor, input(flavor, "default"));
        expect(executions[executions.length - 1]?.state).toMatchObject({
          thinking: "high",
          fast: true,
        });
      });
    }
  },
);
