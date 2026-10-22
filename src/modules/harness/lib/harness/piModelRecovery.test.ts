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
const BASE = "alpha/original";
const CHANGED = "beta/changed";
const FRESH = "gamma/branch/selected";
const models = new Map<string, string>();
const requests: Request[] = [];
const spawns: { nativeId: string; args: unknown }[] = [];
const kills: string[] = [];
const executions: { nativeId: string; type: unknown; model: string }[] = [];
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
function modelData(nativeId: string) {
  const native = models.get(nativeId);
  if (!native) throw new Error("Expected captured native model");
  const separator = native.indexOf("/");
  return {
    provider: native.slice(0, separator),
    id: native.slice(separator + 1),
    contextWindow: native === BASE ? 4096 : native === CHANGED ? 8192 : 16384,
  };
}
function reply(request: Request, success = true) {
  if (success && request.command.type === "set_model")
    models.set(
      request.nativeId,
      `${request.command.provider}/${request.command.modelId}`,
    );
  frame(request.nativeId, {
    type: "response",
    id: request.command.id,
    command: request.command.type,
    success,
    error: success ? undefined : "model rejected",
    data:
      request.command.type === "get_state"
        ? {
            sessionId: `provider_${request.nativeId}`,
            model: modelData(request.nativeId),
          }
        : request.command.type === "set_model"
          ? modelData(request.nativeId)
          : request.command.type === "compact"
            ? { estimatedTokensAfter: 32 }
            : {},
  });
}
function hold() {
  let captured: Request | undefined;
  intercept = (request) => {
    if (request.command.type !== "set_model") return false;
    captured = request;
    return true;
  };
  return () => {
    if (!captured) throw new Error("Expected pending model response");
    return captured;
  };
}
function input(
  flavor: PiFlavor,
  model = BASE,
  sessionId = "model-recovery",
  events: HarnessEvent[] = [],
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:${model}`,
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => events.push(event),
  };
}
function setters() {
  return requests.filter((row) => row.command.type === "set_model");
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
        spawns.push({ nativeId, args: args.args });
        models.set(nativeId, at < 0 ? BASE : argv[at + 1]);
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
          const model = models.get(nativeId);
          if (!model) throw new Error("Expected native execution model");
          executions.push({ nativeId, type: request.command.type, model });
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
  models.clear();
  requests.length = 0;
  spawns.length = 0;
  kills.length = 0;
  executions.length = 0;
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["model-recovery", "sibling"])
      await forgetSession(flavor, id);
});
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id explicit model recovery",
  (flavor) => {
    async function stale(success = true, gap = false) {
      const captured = hold();
      const action = observed(sendTurn(flavor, input(flavor, CHANGED)));
      await flush();
      if (gap) {
        reply(captured(), success);
        await Promise.resolve().then(() =>
          Promise.resolve().then(() => cancelTurn(flavor, "model-recovery")),
        );
      } else {
        await cancelTurn(flavor, "model-recovery");
        reply(captured(), success);
      }
      await action;
      intercept = undefined;
    }
    it.each([false, true])(
      "restores effective prompt model after retired successful ACK, owning gap=%s",
      async (gap) => {
        await sendTurn(flavor, input(flavor));
        await stale(true, gap);
        expect(models.get(spawns[0].nativeId)).toBe(CHANGED);
        await sendTurn(flavor, input(flavor));
        expect(executions[executions.length - 1]?.model).toBe(BASE);
        expect(spawns).toHaveLength(1);
        expect(kills).toEqual([]);
      },
    );
    it.each([false, true])(
      "restores effective compact model and owned context window, owning gap=%s",
      async (gap) => {
        await sendTurn(flavor, input(flavor));
        await stale(true, gap);
        const events: HarnessEvent[] = [];
        await compactContext(
          flavor,
          input(flavor, BASE, "model-recovery", events),
        );
        expect(executions[executions.length - 1]).toMatchObject({
          type: "compact",
          model: BASE,
        });
        expect(events).toContainEqual({
          type: "context",
          used: 32,
          window: 4096,
        });
      },
    );
    it("selects a different fresh explicit reference rather than the old requested model", async () => {
      await sendTurn(flavor, input(flavor));
      await stale();
      await sendTurn(flavor, input(flavor, FRESH));
      expect(executions[executions.length - 1]?.model).toBe(FRESH);
      expect(setters()[setters().length - 1]?.command).toMatchObject({
        provider: "gamma",
        modelId: "branch/selected",
      });
    });
    it("does not mark a retired negative model response dirty", async () => {
      await sendTurn(flavor, input(flavor));
      await stale(false);
      const count = setters().length;
      await sendTurn(flavor, input(flavor));
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]?.model).toBe(BASE);
    });
    it("preserves initial model spawn arguments and healthy cache reuse", async () => {
      await sendTurn(flavor, input(flavor));
      expect(spawns[0].args).toContain(BASE);
      expect(setters()).toHaveLength(0);
      await sendTurn(flavor, input(flavor, CHANGED));
      const count = setters().length;
      await sendTurn(flavor, input(flavor, CHANGED));
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]?.model).toBe(CHANGED);
    });
    it("keeps ordinary model NACK rejection retryable without a reuse barrier", async () => {
      await sendTurn(flavor, input(flavor));
      intercept = (row) => {
        if (row.command.type !== "set_model") return false;
        reply(row, false);
        return true;
      };
      await expect(sendTurn(flavor, input(flavor, CHANGED))).rejects.toThrow(
        "model rejected",
      );
      intercept = undefined;
      await sendTurn(flavor, input(flavor));
      expect(executions[executions.length - 1]?.model).toBe(BASE);
      expect(kills).toEqual([]);
    });
    it("blocks the actor before fresh work when current explicit restoration is rejected", async () => {
      await sendTurn(flavor, input(flavor));
      await stale();
      const executed = executions.length;
      intercept = (row) => {
        if (row.command.type !== "set_model") return false;
        reply(row, false);
        return true;
      };
      const error = await sendTurn(flavor, input(flavor)).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message: "model rejected" });
      const written = requests.length;
      await expect(sendTurn(flavor, input(flavor))).rejects.toBe(error);
      await expect(compactContext(flavor, input(flavor))).rejects.toBe(error);
      expect(requests).toHaveLength(written);
      expect(executions).toHaveLength(executed);
      expect(kills).toEqual([]);
    });
    it.each([true, false])(
      "keeps cancelled restoration retryable after its response success=%s",
      async (success) => {
        await sendTurn(flavor, input(flavor));
        await stale();
        const captured = hold();
        const restore = observed(sendTurn(flavor, input(flavor)));
        await flush();
        expect(requests[requests.length - 1]?.command.type).toBe("set_model");
        await cancelTurn(flavor, "model-recovery");
        reply(captured(), success);
        await restore;
        intercept = undefined;
        const count = setters().length;
        await sendTurn(flavor, input(flavor));
        expect(setters()).toHaveLength(count + 1);
        expect(executions[executions.length - 1]?.model).toBe(BASE);
        expect(spawns).toHaveLength(1);
        expect(kills).toEqual([]);
      },
    );
    it("does not dirty an independent native actor", async () => {
      await sendTurn(flavor, input(flavor));
      await stale();
      await sendTurn(flavor, input(flavor, BASE, "sibling"));
      const count = setters().length;
      await sendTurn(flavor, input(flavor, BASE, "sibling"));
      expect(setters()).toHaveLength(count);
      expect(executions[executions.length - 1]).toMatchObject({
        nativeId: spawns[1].nativeId,
        model: BASE,
      });
      expect(kills).toEqual([]);
    });
    it.each([false, true])(
      "does not dirty a replacement from an old actor, fulfilled response before retirement=%s",
      async (fulfilled) => {
        await sendTurn(flavor, input(flavor));
        const captured = hold();
        const old = observed(sendTurn(flavor, input(flavor, CHANGED)));
        await flush();
        if (fulfilled) reply(captured());
        await stopSession(flavor, "model-recovery");
        await old;
        intercept = undefined;
        await sendTurn(flavor, input(flavor));
        const count = setters().length;
        if (!fulfilled) reply(captured());
        await flush();
        await sendTurn(flavor, input(flavor));
        expect(setters()).toHaveLength(count);
        expect(executions[executions.length - 1]?.model).toBe(BASE);
        expect(spawns).toHaveLength(2);
      },
    );
    it.each(["default", "invalid"])(
      "preserves parse-null %s policy without clearing pending explicit model recovery",
      async (native) => {
        await sendTurn(flavor, input(flavor));
        await stale();
        const count = setters().length;
        await sendTurn(flavor, input(flavor, native));
        expect(setters()).toHaveLength(count);
        expect(executions[executions.length - 1]?.model).toBe(CHANGED);
        await sendTurn(flavor, input(flavor));
        expect(executions[executions.length - 1]?.model).toBe(BASE);
      },
    );
    if (flavor.id === "omp")
      it("does not clear recovery from an untagged model configuration frame", async () => {
        await sendTurn(flavor, input(flavor));
        await stale();
        await sendTurn(flavor, input(flavor, "default"));
        frame(spawns[0].nativeId, {
          type: "config_update",
          model: { provider: "alpha", id: "original" },
        });
        await sendTurn(flavor, input(flavor));
        expect(executions[executions.length - 1]?.model).toBe(BASE);
      });
  },
);
