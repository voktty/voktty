import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as child from "./child";
import {
  bindSession,
  cancelTurn,
  compactContext,
  forgetSession,
  respondApproval,
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
const kills: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const pids = new Map<string, number>();
let nextPid = 100;
let release: (() => void) | undefined;
let intercept: ((request: Request) => boolean | Promise<void>) | undefined;
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
function reply(request: Request, success = true, error?: string): void {
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
          : {},
  });
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  id = "reuse-pi",
): SendTurnInput {
  return {
    sessionId: id,
    cwd: "/repo",
    model: `${flavor.id}:default`,
    modelSettings: { thinking: "off" },
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => events.push(event),
  };
}
function configure(request: SendTurnInput, type: string): void {
  if (type === "set_model")
    request.model = `${request.model.split(":")[0]}:anthropic/selected`;
  else if (type === "set_thinking_level")
    request.modelSettings = { thinking: "high" };
  else request.modelSettings = { thinking: "off", fast: "true" };
}
function latestNativeId(): string {
  const spawn = spawns[spawns.length - 1];
  if (!spawn) throw new Error("Expected native actor");
  return String(spawn.sessionId);
}
function pendingWrite() {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_, no) => {
    reject = no;
  });
  observed(promise);
  return { promise, reject };
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
      if (command === "harness_kill") kills.push(id);
      if (command === "harness_write") {
        const request = {
          nativeId: id,
          command: JSON.parse(String(args.line)) as Record<string, unknown>,
        };
        requests.push(request);
        const held = intercept?.(request);
        if (held) {
          if (held !== true) await held;
          return undefined as T;
        }
        if (request.command.type === "extension_ui_response")
          return undefined as T;
        reply(request);
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
  kills.length = 0;
  intercept = undefined;
  autoPrompt = true;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["reuse-pi", "sibling"]) await forgetSession(flavor, id);
  vi.useRealTimers();
});

async function expectBlocked(flavor: PiFlavor, error: unknown): Promise<void> {
  const count = requests.length;
  await expect(sendTurn(flavor, input(flavor))).rejects.toBe(error);
  await expect(compactContext(flavor, input(flavor))).rejects.toBe(error);
  await expect(rewindLastTurn(flavor, input(flavor))).rejects.toBe(error);
  expect(requests).toHaveLength(count);
  expect(spawns).toHaveLength(1);
}

describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id uncertain native reuse",
  (flavor) => {
    it.each(["set_model", "set_thinking_level"])(
      "preserves a %s write failure and blocks further writes on its exact actor",
      async (type) => {
        await observed(sendTurn(flavor, input(flavor)));
        const original = new Error("Unrecognized command");
        intercept = (request) => {
          if (request.command.type === type) throw original;
          return false;
        };
        const events: HarnessEvent[] = [];
        const request = input(flavor, events);
        configure(request, type);
        let accepted = 0;
        request.onAccepted = () => accepted++;
        await expect(sendTurn(flavor, request)).rejects.toBe(original);
        intercept = undefined;
        await expectBlocked(flavor, original);
        expect(accepted).toBe(0);
        expect(
          events.filter((event) => event.type === "session.configChanged"),
        ).toEqual([]);
      },
    );

    it.each(["set_model", "set_thinking_level"])(
      "does not interpret a %s deadline as an acknowledged command failure",
      async (type) => {
        await observed(sendTurn(flavor, input(flavor)));
        vi.useFakeTimers();
        intercept = (request) => request.command.type === type;
        const request = input(flavor);
        configure(request, type);
        const action = observed(sendTurn(flavor, request));
        await flush();
        await vi.advanceTimersByTimeAsync(15_000);
        const failure: unknown = await action.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).toHaveProperty(
          "message",
          `${flavor.label} ${type} timed out`,
        );
        intercept = undefined;
        await expectBlocked(flavor, failure);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it.each(["compact", "get_fork_messages", "fork", "get_state"])(
      "blocks actor reuse after an uncertain %s control write",
      async (type) => {
        await observed(sendTurn(flavor, input(flavor)));
        const original = new Error("control write failed");
        intercept = (request) => {
          if (request.command.type === type) throw original;
          return false;
        };
        await expect(
          type === "compact"
            ? compactContext(flavor, input(flavor))
            : rewindLastTurn(flavor, input(flavor)),
        ).rejects.toBe(original);
        intercept = undefined;
        await expectBlocked(flavor, original);
      },
    );

    it("preserves confirmed thinking fallback even when its remote message resembles transport loss", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      intercept = (request) => {
        if (request.command.type !== "set_thinking_level") return false;
        reply(request, false, `${flavor.label} process is not running`);
        return true;
      };
      const request = input(flavor);
      configure(request, "set_thinking_level");
      await observed(sendTurn(flavor, request));
      intercept = undefined;
      await observed(sendTurn(flavor, request));
      expect(
        requests.filter((row) => row.command.type === "set_thinking_level"),
      ).toHaveLength(1);
      expect(
        requests.filter((row) => row.command.type === "prompt"),
      ).toHaveLength(3);
    });

    it("does not let a previously acknowledged Error authorize a later failed transport write", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      intercept = (request) => {
        if (request.command.type !== "set_model") return false;
        reply(request, false, "Unsupported setting");
        return true;
      };
      const request = input(flavor);
      configure(request, "set_model");
      const original: unknown = await sendTurn(flavor, request).catch(
        (error: unknown) => error,
      );
      expect(original).toBeInstanceOf(Error);
      intercept = (row) => {
        if (row.command.type === "set_thinking_level") throw original;
        return false;
      };
      const thinking = input(flavor);
      configure(thinking, "set_thinking_level");
      await expect(sendTurn(flavor, thinking)).rejects.toBe(original);
      intercept = undefined;
      await expectBlocked(flavor, original);
    });

    it("fails closed after an unsuccessful abort instead of using its message as proof of quiescence", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      intercept = (request) => {
        if (request.command.type !== "abort") return false;
        reply(request, false, "Nothing is running");
        return true;
      };
      await cancelTurn(flavor, "reuse-pi");
      intercept = undefined;
      const failure: unknown = await sendTurn(flavor, input(flavor)).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toHaveProperty("message", "Nothing is running");
      await expectBlocked(flavor, failure);
    });

    it("blocks actor reuse after a current prompt transport failure", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const original = new Error("prompt write failed");
      intercept = (request) => {
        if (request.command.type === "prompt") throw original;
        return false;
      };
      await expect(sendTurn(flavor, input(flavor))).rejects.toBe(original);
      intercept = undefined;
      await expectBlocked(flavor, original);
    });

    it("settles the captured active turn when a concurrent steer write becomes uncertain", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      autoPrompt = false;
      const active = observed(sendTurn(flavor, input(flavor)));
      await flush();
      const original = new Error("steer write failed");
      intercept = (request) => {
        if (request.command.type === "steer") throw original;
        return false;
      };
      await expect(steerTurn(flavor, input(flavor))).rejects.toBe(original);
      intercept = undefined;
      frame(latestNativeId(), { type: "agent_settled" });
      await expect(active).rejects.toBe(original);
      await expectBlocked(flavor, original);
    });

    it("blocks queued fresh work when an old same-native steer write fails late", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      autoPrompt = false;
      const oldTurn = observed(sendTurn(flavor, input(flavor)));
      await flush();
      const held = pendingWrite();
      intercept = (request) =>
        request.command.type === "steer" ? held.promise : false;
      const oldSteer = observed(steerTurn(flavor, input(flavor)));
      await flush();
      await cancelTurn(flavor, "reuse-pi");
      await oldTurn;
      intercept = undefined;
      const count = requests.length;
      const fresh = observed(sendTurn(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      const original = new Error("old native write outcome unknown");
      held.reject(original);
      await expect(oldSteer).rejects.toThrow(/retired/i);
      frame(latestNativeId(), { type: "agent_settled" });
      await expect(fresh).rejects.toBe(original);
      await expectBlocked(flavor, original);
    });

    it("does not deliver pending approval replies or late frames from a blocked actor", async () => {
      const events: HarnessEvent[] = [];
      await observed(sendTurn(flavor, input(flavor, events)));
      const nativeId = latestNativeId();
      frame(nativeId, {
        type: "extension_ui_request",
        id: "ui",
        method: "confirm",
        title: "Confirm",
      });
      await flush();
      const approval = events.find(
        (event) => event.type === "approval.requested",
      );
      if (approval?.type !== "approval.requested")
        throw new Error("Expected approval");
      const original = new Error("uncertain control");
      intercept = (request) => {
        if (request.command.type === "compact") throw original;
        return false;
      };
      await expect(compactContext(flavor, input(flavor, events))).rejects.toBe(
        original,
      );
      intercept = undefined;
      const eventCount = events.length;
      respondApproval(flavor, "reuse-pi", approval.requestId, "allow");
      frame(nativeId, { type: "assistant_delta", kind: "text", text: "late" });
      frame(nativeId, {
        type: "extension_ui_request",
        id: "late-ui",
        method: "confirm",
        title: "Late",
      });
      await flush();
      expect(events).toHaveLength(eventCount);
      expect(
        requests.filter((row) => row.command.type === "extension_ui_response"),
      ).toEqual([]);
    });

    it("retains exact cleanup and allows an explicitly stopped actor to be replaced", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const oldId = latestNativeId();
      const original = new Error("uncertain old actor");
      intercept = (request) => {
        if (request.command.type === "compact") throw original;
        return false;
      };
      await expect(compactContext(flavor, input(flavor))).rejects.toBe(
        original,
      );
      intercept = undefined;
      await expectBlocked(flavor, original);
      await stopSession(flavor, "reuse-pi");
      await observed(sendTurn(flavor, input(flavor)));
      expect(latestNativeId()).not.toBe(oldId);
      expect(spawns).toHaveLength(2);
    });

    it("does not block a replacement native actor when an old captured write fails", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const held = pendingWrite();
      const oldId = latestNativeId();
      intercept = (request) =>
        request.command.type === "set_model" ? held.promise : false;
      const request = input(flavor);
      configure(request, "set_model");
      const old = observed(sendTurn(flavor, request));
      await flush();
      await stopSession(flavor, "reuse-pi");
      intercept = undefined;
      await observed(sendTurn(flavor, input(flavor)));
      held.reject(new Error("old write failed"));
      await old;
      await observed(sendTurn(flavor, input(flavor)));
      expect(latestNativeId()).not.toBe(oldId);
      expect(spawns).toHaveLength(2);
    });

    it("does not classify a successful old model acknowledgement as transport uncertainty", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      let captured: Request | undefined;
      intercept = (request) => {
        if (request.command.type !== "set_model") return false;
        captured = request;
        return true;
      };
      const request = input(flavor);
      configure(request, "set_model");
      const old = observed(sendTurn(flavor, request));
      await flush();
      await cancelTurn(flavor, "reuse-pi");
      intercept = undefined;
      if (!captured) throw new Error("Expected old model stage");
      reply(captured);
      await old;
      await observed(sendTurn(flavor, input(flavor)));
      expect(spawns).toHaveLength(1);
      expect(kills).toEqual([]);
    });

    it.each([false, true])(
      "retains a failed cold state actor until explicit stop, resume=%s",
      async (resume) => {
        if (resume) bindSession(flavor, "reuse-pi", "saved-provider", "/repo");
        const original = new Error("cold state transport uncertain");
        intercept = (request) => {
          if (request.command.type === "get_state") throw original;
          return false;
        };
        await expect(sendTurn(flavor, input(flavor))).rejects.toBe(original);
        intercept = undefined;
        const count = requests.length;
        await expect(sendTurn(flavor, input(flavor))).rejects.toBe(original);
        expect(requests).toHaveLength(count);
        expect(spawns).toHaveLength(1);
        expect(kills).toEqual([]);
        const nativeId = latestNativeId();
        await stopSession(flavor, "reuse-pi");
        expect(kills).toContain(nativeId);
        await observed(sendTurn(flavor, input(flavor)));
        expect(latestNativeId()).not.toBe(nativeId);
      },
    );

    it("retains the ordinary cold-resume fallback for a confirmed command rejection", async () => {
      bindSession(flavor, "reuse-pi", "saved-provider", "/repo");
      intercept = (request) => {
        if (request.command.type !== "get_state") return false;
        intercept = undefined;
        reply(request, false, "Saved provider session unavailable");
        return true;
      };
      await observed(sendTurn(flavor, input(flavor)));
      expect(spawns).toHaveLength(2);
      expect(spawns[0]?.args).toContain("saved-provider");
      expect(spawns[1]?.args).not.toContain("saved-provider");
    });

    it("does not classify finalizer cancellation after an acknowledged agent completion as native uncertainty", async () => {
      intercept = (request) => {
        if (request.command.type !== "prompt") return false;
        frame(request.nativeId, { type: "agent_settled" });
        return true;
      };
      await observed(sendTurn(flavor, input(flavor)));
      intercept = undefined;
      await observed(sendTurn(flavor, input(flavor)));
      expect(spawns).toHaveLength(1);
    });

    it("does not confuse an onAccepted callback failure with RPC provenance", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const original = new Error("caller callback failed");
      const request = input(flavor);
      request.onAccepted = () => {
        throw original;
      };
      await expect(sendTurn(flavor, request)).rejects.toBe(original);
      await observed(sendTurn(flavor, input(flavor)));
      expect(spawns).toHaveLength(1);
    });

    it("keeps native exit ownership after poisoning the actor's delivery state", async () => {
      const events: HarnessEvent[] = [];
      await observed(sendTurn(flavor, input(flavor, events)));
      const nativeId = latestNativeId();
      const pid = pids.get(nativeId);
      if (!pid) throw new Error("Expected original positive native PID");
      const original = new Error("observed transport failure");
      intercept = (request) => {
        if (request.command.type === "compact") throw original;
        return false;
      };
      await expect(compactContext(flavor, input(flavor, events))).rejects.toBe(
        original,
      );
      intercept = undefined;
      await expectBlocked(flavor, original);
      const exit = listeners.get("harness-exit");
      if (!exit) throw new Error("Expected captured native exit bridge");
      exit({ payload: { sessionId: nativeId, pid: pid + 1000, code: 99 } });
      expect(events.filter((event) => event.type === "session.ended")).toEqual(
        [],
      );
      exit({ payload: { sessionId: nativeId, pid, code: 13 } });
      exit({ payload: { sessionId: nativeId, pid, code: 13 } });
      await flush();
      expect(events.filter((event) => event.type === "session.ended")).toEqual([
        { type: "session.ended", code: 13 },
      ]);
      expect(kills).toContain(nativeId);
      await observed(sendTurn(flavor, input(flavor)));
      expect(latestNativeId()).not.toBe(nativeId);
      expect(spawns).toHaveLength(2);
    });

    it("preserves a genuine current positive-PID exit rather than turning it into a transport fallback", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      intercept = (request) => request.command.type === "set_thinking_level";
      const request = input(flavor);
      configure(request, "set_thinking_level");
      const action = observed(sendTurn(flavor, request));
      await flush();
      const nativeId = latestNativeId();
      const pid = pids.get(nativeId);
      if (!pid) throw new Error("Expected positive native PID");
      listeners.get("harness-exit")?.({
        payload: { sessionId: nativeId, pid, code: 7 },
      });
      await expect(action).rejects.toThrow(`${flavor.label} exited`);
    });
  },
);

describe("omp fast failure provenance", () => {
  it("retains a failed cold fast configuration instead of admitting a new actor", async () => {
    const original = new Error("cold fast write uncertain");
    intercept = (request) => {
      if (request.command.type === "set_fast_mode") throw original;
      return false;
    };
    const request = input(OMP_FLAVOR);
    configure(request, "set_fast_mode");
    await expect(sendTurn(OMP_FLAVOR, request)).rejects.toBe(original);
    intercept = undefined;
    await expect(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR))).rejects.toBe(
      original,
    );
    expect(spawns).toHaveLength(1);
    expect(kills).toEqual([]);
  });

  it("preserves a recognized asynchronous prompt rejection after its initial ACK", async () => {
    await observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR)));
    autoPrompt = false;
    const action = observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR)));
    await flush();
    const prompt = requests[requests.length - 1];
    if (prompt?.command.type !== "prompt") throw new Error("Expected prompt");
    reply(prompt, false, "Asynchronous provider rejection");
    await expect(action).rejects.toThrow("Asynchronous provider rejection");
    autoPrompt = true;
    await observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR)));
    expect(spawns).toHaveLength(1);
  });

  it.each(["write", "timeout"])(
    "does not publish fast fallback after an uncertain %s",
    async (kind) => {
      await observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR)));
      const original = new Error("Unsupported command");
      if (kind === "timeout") vi.useFakeTimers();
      intercept = (request) => {
        if (request.command.type !== "set_fast_mode") return false;
        if (kind === "write") throw original;
        return true;
      };
      const events: HarnessEvent[] = [];
      const request = input(OMP_FLAVOR, events);
      configure(request, "set_fast_mode");
      const action = observed(sendTurn(OMP_FLAVOR, request));
      await flush();
      if (kind === "timeout") await vi.advanceTimersByTimeAsync(15_000);
      const failure: unknown = await action.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      if (kind === "write") expect(failure).toBe(original);
      intercept = undefined;
      await expectBlocked(OMP_FLAVOR, failure);
      expect(
        events.filter((event) => event.type === "session.configChanged"),
      ).toEqual([]);
    },
  );

  it("preserves acknowledged fast fallback even when its remote text says write failed", async () => {
    await observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR)));
    intercept = (request) => {
      if (request.command.type !== "set_fast_mode") return false;
      reply(request, false, "write failed");
      return true;
    };
    const events: HarnessEvent[] = [];
    const request = input(OMP_FLAVOR, events);
    configure(request, "set_fast_mode");
    await observed(sendTurn(OMP_FLAVOR, request));
    intercept = undefined;
    await observed(sendTurn(OMP_FLAVOR, request));
    expect(
      events.filter((event) => event.type === "session.configChanged"),
    ).toContainEqual({
      type: "session.configChanged",
      modelSettings: { fast: "false" },
    });
    expect(
      requests.filter((row) => row.command.type === "set_fast_mode"),
    ).toHaveLength(1);
  });
});
