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
import type { SendTurnInput } from "@/modules/harness/lib/harness/types";
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
type State = { thinking: string; fast: boolean };
const requests: Request[] = [];
const executions: { nativeId: string; type: unknown; state: State }[] = [];
const states = new Map<string, State>();
const spawns: string[] = [];
const kills: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let intercept: ((request: Request) => boolean) | undefined;
let release: (() => void) | undefined;
function observed<T>(promise: Promise<T>): Promise<T> {
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
  if (!state) throw new Error("Expected captured native state");
  if (success && request.command.type === "set_thinking_level")
    state.thinking = String(request.command.level);
  if (success && request.command.type === "set_fast_mode")
    state.fast = request.command.enabled === true;
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
            thinkingLevel: state.thinking,
            fastModeEnabled: state.fast,
          }
        : request.command.type === "set_fast_mode"
          ? { enabled: state.fast }
          : {},
  });
}
function hold(type: string) {
  let captured: Request | undefined;
  intercept = (request) => {
    if (request.command.type !== type) return false;
    captured = request;
    return true;
  };
  return () => {
    if (!captured) throw new Error("Expected pending setter response");
    return captured;
  };
}
function input(
  flavor: PiFlavor,
  changed = false,
  fast = false,
  sessionId = "setting-recovery",
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:default`,
    runtimeMode: "supervised",
    text: "hello",
    modelSettings: fast
      ? { thinking: "off", fast: String(changed) }
      : { thinking: changed ? "high" : "off" },
    onEvent: () => undefined,
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
        states.set(nativeId, { thinking: "off", fast: false });
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
          if (!state) throw new Error("Expected live native state");
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
  requests.length = 0;
  executions.length = 0;
  spawns.length = 0;
  kills.length = 0;
  states.clear();
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["setting-recovery", "sibling"])
      await forgetSession(flavor, id);
});
const settings = [
  { flavor: PI_FLAVOR, fast: false, type: "set_thinking_level" },
  { flavor: OMP_FLAVOR, fast: false, type: "set_thinking_level" },
  { flavor: OMP_FLAVOR, fast: true, type: "set_fast_mode" },
];
describe.each(settings)(
  "$flavor.id $type physical recovery",
  ({ flavor, fast, type }) => {
    function request(changed = false, id = "setting-recovery") {
      return input(flavor, changed, fast, id);
    }
    function setters() {
      return requests.filter((row) => row.command.type === type);
    }
    async function stale(success = true, gap = false) {
      const captured = hold(type);
      const action = observed(sendTurn(flavor, request(true)));
      await flush();
      if (gap) {
        reply(captured(), success);
        await Promise.resolve().then(() =>
          Promise.resolve().then(() => cancelTurn(flavor, "setting-recovery")),
        );
      } else {
        await cancelTurn(flavor, "setting-recovery");
        reply(captured(), success);
      }
      await action;
      intercept = undefined;
    }
    it.each([false, true])(
      "restores effective prompt configuration after retired successful ACK, owning gap=%s",
      async (gap) => {
        await sendTurn(flavor, request());
        await stale(true, gap);
        const nativeId = spawns[0];
        expect(states.get(nativeId)).toEqual(
          fast
            ? { thinking: "off", fast: true }
            : { thinking: "high", fast: false },
        );
        await sendTurn(flavor, request());
        expect(executions[executions.length - 1]?.state).toEqual({
          thinking: "off",
          fast: false,
        });
        expect(spawns).toHaveLength(1);
        expect(kills).toEqual([]);
      },
    );
    it.each([false, true])(
      "restores effective compact configuration after retired successful ACK, owning gap=%s",
      async (gap) => {
        await sendTurn(flavor, request());
        await stale(true, gap);
        await compactContext(flavor, request());
        expect(executions[executions.length - 1]).toMatchObject({
          type: "compact",
          state: { thinking: "off", fast: false },
        });
      },
    );
    it("does not dirty state for a retired negative response", async () => {
      await sendTurn(flavor, request());
      const before = setters().length;
      await stale(false);
      await sendTurn(flavor, request());
      expect(setters()).toHaveLength(before + 1);
      expect(executions[executions.length - 1]?.state).toEqual({
        thinking: "off",
        fast: false,
      });
    });
    it("preserves ordinary unsupported-setting compatibility without restoration", async () => {
      await sendTurn(flavor, request());
      intercept = (row) => {
        if (row.command.type !== type) return false;
        reply(row, false);
        return true;
      };
      await sendTurn(flavor, request(true));
      const count = setters().length;
      await sendTurn(flavor, request(true));
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]?.state).toEqual({
        thinking: "off",
        fast: false,
      });
      expect(kills).toEqual([]);
    });
    it("keeps dirty settings local to their native actor", async () => {
      await sendTurn(flavor, request());
      await stale();
      await sendTurn(flavor, request(false, "sibling"));
      const count = setters().length;
      await sendTurn(flavor, request(false, "sibling"));
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]?.nativeId).toBe(spawns[1]);
      expect(executions[executions.length - 1]?.state).toEqual({
        thinking: "off",
        fast: false,
      });
      expect(spawns).toHaveLength(2);
      expect(kills).toEqual([]);
    });
    it("preserves legacy initial thinking behavior and fast setup caching", async () => {
      await sendTurn(flavor, request(true));
      expect(setters()).toHaveLength(fast ? 1 : 0);
      await sendTurn(flavor, request(true));
      expect(setters()).toHaveLength(fast ? 1 : 0);
      expect(executions[executions.length - 1]?.state).toEqual({
        thinking: "off",
        fast,
      });
    });
    it("keeps healthy caching after guarded successful commit", async () => {
      await sendTurn(flavor, request());
      await sendTurn(flavor, request(true));
      const count = setters().length;
      await sendTurn(flavor, request(true));
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]?.state).toEqual(
        fast
          ? { thinking: "off", fast: true }
          : { thinking: "high", fast: false },
      );
    });
    it("blocks further work when current restoration is rejected", async () => {
      await sendTurn(flavor, request());
      await stale();
      const executed = executions.length;
      intercept = (row) => {
        if (row.command.type !== type) return false;
        reply(row, false);
        return true;
      };
      const error = await sendTurn(flavor, request()).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      const written = requests.length;
      await expect(sendTurn(flavor, request())).rejects.toBe(error);
      await expect(compactContext(flavor, request())).rejects.toBe(error);
      expect(requests).toHaveLength(written);
      expect(executions).toHaveLength(executed);
      expect(kills).toEqual([]);
    });
    it("keeps restoration dirty after another cancelled successful restoration", async () => {
      await sendTurn(flavor, request());
      await stale();
      const captured = hold(type);
      const restore = observed(sendTurn(flavor, request()));
      await flush();
      expect(requests[requests.length - 1]?.command.type).toBe(type);
      await cancelTurn(flavor, "setting-recovery");
      reply(captured());
      await restore;
      intercept = undefined;
      const count = setters().length;
      await sendTurn(flavor, request());
      expect(setters()).toHaveLength(count + 1);
      expect(executions[executions.length - 1]?.state).toEqual({
        thinking: "off",
        fast: false,
      });
    });
    it("keeps a retired restoration NACK retryable by a fresh owner", async () => {
      await sendTurn(flavor, request());
      await stale();
      const captured = hold(type);
      const restore = observed(sendTurn(flavor, request()));
      await flush();
      expect(requests[requests.length - 1]?.command.type).toBe(type);
      await cancelTurn(flavor, "setting-recovery");
      reply(captured(), false);
      await restore;
      intercept = undefined;
      await sendTurn(flavor, request());
      expect(executions[executions.length - 1]?.state).toEqual({
        thinking: "off",
        fast: false,
      });
      expect(spawns).toHaveLength(1);
      expect(kills).toEqual([]);
    });
    it("does not restore or dirty a replacement from an old actor ACK", async () => {
      await sendTurn(flavor, request());
      const captured = hold(type);
      const old = observed(sendTurn(flavor, request(true)));
      await flush();
      await stopSession(flavor, "setting-recovery");
      await old;
      intercept = undefined;
      await sendTurn(flavor, request());
      const count = setters().length;
      reply(captured());
      await flush();
      await sendTurn(flavor, request());
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]?.state).toEqual({
        thinking: "off",
        fast: false,
      });
      expect(spawns).toHaveLength(2);
    });
  },
);
