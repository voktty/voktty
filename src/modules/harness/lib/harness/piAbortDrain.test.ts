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
  cancelTurn,
  compactContext,
  forgetSession,
  rewindLastTurn,
  sendTurn,
  setPiBinaryResolver,
  stopSession,
} from "./piFamily";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import type { HarnessEvent, SendTurnInput } from "./types";

type Request = { nativeId: string; command: Record<string, unknown> };
const requests: Request[] = [];
const spawns: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let release: (() => void) | undefined;
let intercept: ((request: Request) => boolean) | undefined;
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
function reply(request: Request, success = true, error?: string) {
  frame(request.nativeId, {
    type: "response",
    id: request.command.id,
    command: request.command.type,
    success,
    error,
    data:
      request.command.type === "get_state"
        ? { sessionId: `provider_${request.nativeId}` }
        : request.command.type === "get_fork_messages"
          ? { messages: [{ entryId: "entry", text: "previous" }] }
          : {},
  });
}
function input(
  flavor: PiFlavor,
  onEvent: (event: HarnessEvent) => void = () => undefined,
): SendTurnInput {
  return {
    sessionId: "abort-drain",
    cwd: "/repo",
    model: `${flavor.id}:default`,
    modelSettings: { thinking: "off" },
    runtimeMode: "supervised",
    text: "hello",
    onEvent,
  };
}
function lastAbort(): Request {
  const request = [...requests]
    .reverse()
    .find((row) => row.command.type === "abort");
  if (!request) throw new Error("Expected captured abort");
  return request;
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
        requests.push(request);
        if (intercept?.(request)) return undefined as T;
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
  autoPrompt = true;
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    await forgetSession(flavor, "abort-drain");
  vi.useRealTimers();
});
function action(flavor: PiFlavor, kind: string) {
  const request = input(flavor);
  request.modelSettings = { thinking: "high" };
  return kind === "send"
    ? sendTurn(flavor, request)
    : kind === "compact"
      ? compactContext(flavor, request)
      : rewindLastTurn(flavor, request);
}
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id pending abort ownership",
  (flavor) => {
    it.each(["send", "compact", "rewind"])(
      "holds new %s settings and writes until the exact abort ACK",
      async (kind) => {
        await sendTurn(flavor, input(flavor));
        intercept = (request) => request.command.type === "abort";
        const cancellation = observed(cancelTurn(flavor, "abort-drain"));
        const abort = lastAbort();
        const count = requests.length;
        const fresh = observed(action(flavor, kind));
        await flush();
        expect(requests).toHaveLength(count);
        reply(abort);
        await cancellation;
        await fresh;
        expect(requests[count]?.command.type).toBe("set_thinking_level");
        expect(spawns).toHaveLength(1);
      },
    );

    it("coalesces reentrant cancellation before native abort starts without reviving queued work", async () => {
      await sendTurn(flavor, input(flavor));
      autoPrompt = false;
      let second: Promise<void> | undefined;
      let queued: Promise<void> | undefined;
      const active = observed(
        sendTurn(
          flavor,
          input(flavor, (event) => {
            if (event.type !== "message.completed") return;
            queued = observed(sendTurn(flavor, input(flavor)));
            second = observed(cancelTurn(flavor, "abort-drain"));
          }),
        ),
      );
      await flush();
      intercept = (request) => request.command.type === "abort";
      const first = observed(cancelTurn(flavor, "abort-drain"));
      await flush();
      expect(
        requests.filter((row) => row.command.type === "abort"),
      ).toHaveLength(1);
      reply(lastAbort());
      await first;
      await second;
      await active;
      await queued;
      expect(
        requests.filter((row) => row.command.type === "prompt"),
      ).toHaveLength(2);
      autoPrompt = true;
      await sendTurn(flavor, input(flavor));
    });

    it("starts and drains the exact abort even when completion callback throws", async () => {
      await sendTurn(flavor, input(flavor));
      autoPrompt = false;
      const original = new Error("completion callback failed");
      const active = observed(
        sendTurn(
          flavor,
          input(flavor, (event) => {
            if (event.type === "message.completed") throw original;
          }),
        ),
      );
      await flush();
      intercept = (request) => request.command.type === "abort";
      const cancellation = observed(cancelTurn(flavor, "abort-drain"));
      const count = requests.length;
      autoPrompt = true;
      const fresh = observed(sendTurn(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      reply(lastAbort());
      await expect(cancellation).rejects.toBe(original);
      await active;
      await fresh;
    });

    it.each(["nack", "write", "timeout"])(
      "blocks queued writes before opening a failed %s abort gate",
      async (kind) => {
        await sendTurn(flavor, input(flavor));
        if (kind === "timeout") vi.useFakeTimers();
        const original = new Error("abort writer failed");
        intercept = (request) => {
          if (request.command.type !== "abort") return false;
          if (kind === "write") throw original;
          return true;
        };
        const cancellation = observed(cancelTurn(flavor, "abort-drain"));
        const abort = lastAbort();
        const count = requests.length;
        const fresh = observed(sendTurn(flavor, input(flavor)));
        await flush();
        expect(requests).toHaveLength(count);
        if (kind === "nack") reply(abort, false, "Abort refused");
        if (kind === "timeout") await vi.advanceTimersByTimeAsync(5000);
        await cancellation;
        const failure: unknown = await fresh.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        if (kind === "write") expect(failure).toBe(original);
        if (kind === "nack")
          expect(failure).toHaveProperty("message", "Abort refused");
        if (kind === "timeout")
          expect(failure).toHaveProperty(
            "message",
            `${flavor.label} abort timed out`,
          );
        expect(requests).toHaveLength(count);
      },
    );

    it("retires a waiter when another cancel shares the same pending abort", async () => {
      await sendTurn(flavor, input(flavor));
      intercept = (request) => request.command.type === "abort";
      const first = observed(cancelTurn(flavor, "abort-drain"));
      const count = requests.length;
      const queued = observed(sendTurn(flavor, input(flavor)));
      await flush();
      const second = observed(cancelTurn(flavor, "abort-drain"));
      await flush();
      expect(requests).toHaveLength(count);
      reply(lastAbort());
      await first;
      await second;
      await queued;
      expect(requests).toHaveLength(count);
    });

    it.each(["send", "compact"])(
      "retires %s between successful abort settlement and its caller continuation",
      async (kind) => {
        await sendTurn(flavor, input(flavor));
        intercept = (request) => request.command.type === "abort";
        const first = observed(cancelTurn(flavor, "abort-drain"));
        const count = requests.length;
        const queued = observed(action(flavor, kind));
        await flush();
        reply(lastAbort());
        const second = observed(
          Promise.resolve().then(() =>
            Promise.resolve().then(() => cancelTurn(flavor, "abort-drain")),
          ),
        );
        await flush();
        expect(
          requests.filter((row) => row.command.type === "abort"),
        ).toHaveLength(2);
        expect(requests).toHaveLength(count + 1);
        reply(lastAbort());
        await first;
        await second;
        if (kind === "send") await queued;
        else await expect(queued).rejects.toThrow(/retired/i);
        expect(requests).toHaveLength(count + 1);
      },
    );

    it("releases only the captured gate on stop and permits independent replacement", async () => {
      await sendTurn(flavor, input(flavor));
      vi.useFakeTimers();
      intercept = (request) => request.command.type === "abort";
      const cancellation = observed(cancelTurn(flavor, "abort-drain"));
      const oldAbort = lastAbort();
      const count = requests.length;
      const oldQueued = observed(sendTurn(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      let cancelled = false;
      let retired = false;
      void cancellation.then(() => {
        cancelled = true;
      });
      void oldQueued.then(() => {
        retired = true;
      });
      await stopSession(flavor, "abort-drain");
      await flush();
      expect(cancelled).toBe(true);
      expect(retired).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await cancellation;
      await oldQueued;
      intercept = undefined;
      await sendTurn(flavor, input(flavor));
      reply(oldAbort, false, "late old rejection");
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(2);
      expect(spawns[1]).not.toBe(oldAbort.nativeId);
    });

    it("releases a held abort on exact positive-PID exit without waiting for deadline", async () => {
      await sendTurn(flavor, input(flavor));
      vi.useFakeTimers();
      intercept = (request) => request.command.type === "abort";
      const cancellation = observed(cancelTurn(flavor, "abort-drain"));
      const oldAbort = lastAbort();
      const queued = observed(sendTurn(flavor, input(flavor)));
      await flush();
      let cancelled = false;
      let retired = false;
      void cancellation.then(() => {
        cancelled = true;
      });
      void queued.then(
        () => undefined,
        () => {
          retired = true;
        },
      );
      listeners.get("harness-exit")?.({
        payload: { sessionId: oldAbort.nativeId, pid: 123, code: 9 },
      });
      await flush();
      expect(cancelled).toBe(true);
      expect(retired).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await cancellation;
      await expect(queued).rejects.toThrow(`${flavor.label} exited`);
      intercept = undefined;
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(2);
    });
  },
);
