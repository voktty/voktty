import * as child from "@/modules/harness/lib/harness/child";
import {
  cancelTurn,
  compactContext,
  forgetSession,
  rewindLastTurn,
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
const requests: Request[] = [];
const spawns: string[] = [];
const kills: string[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let intercept: ((request: Request) => Promise<void> | undefined) | undefined;
let release: (() => void) | undefined;
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
  const value = { promise, resolve, reject };
  outstanding.push(value);
  return value;
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
        : request.command.type === "get_fork_messages"
          ? { messages: [{ entryId: "e1", text: "first" }] }
          : {},
  });
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  sessionId = "writer-drain",
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:default`,
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => events.push(event),
  };
}
const kinds = ["prompt", "compact", "rewind"] as const;
function fresh(
  flavor: PiFlavor,
  kind: (typeof kinds)[number],
  events: HarnessEvent[] = [],
) {
  const request = input(flavor, events);
  return kind === "prompt"
    ? sendTurn(flavor, request)
    : kind === "compact"
      ? compactContext(flavor, request)
      : rewindLastTurn(flavor, request);
}
function holdOne() {
  const held = deferred();
  let used = false;
  intercept = (request) => {
    if (used || request.command.type !== "compact") return;
    used = true;
    reply(request);
    return held.promise;
  };
  return held;
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
  spawns.length = 0;
  kills.length = 0;
  outstanding.length = 0;
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const value of outstanding) value.resolve();
  await flush();
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["writer-drain", "sibling"])
      await forgetSession(flavor, id);
});
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id retired actual writer drain",
  (flavor) => {
    async function retired() {
      await sendTurn(flavor, input(flavor));
      const held = holdOne();
      await compactContext(flavor, input(flavor));
      await cancelTurn(flavor, "writer-drain");
      return held;
    }
    it.each(kinds)(
      "waits before new %s writes and sink adoption until actual old writer fulfills",
      async (kind) => {
        const held = await retired();
        const count = requests.length;
        const events: HarnessEvent[] = [];
        let settled = false;
        const action = observed(
          fresh(flavor, kind, events).then(() => {
            settled = true;
          }),
        );
        await flush();
        expect(settled).toBe(false);
        expect(requests).toHaveLength(count);
        expect(events).toEqual([]);
        expect(kills).toEqual([]);
        held.resolve();
        await action;
        expect(requests.length).toBeGreaterThan(count);
        expect(spawns).toHaveLength(1);
      },
    );
    it.each(kinds)(
      "rejects waiting %s with original actual writer failure before any new write",
      async (kind) => {
        const held = await retired();
        const count = requests.length;
        const action = observed(fresh(flavor, kind));
        await flush();
        expect(requests).toHaveLength(count);
        const original = new Error("retired actual writer failed");
        held.reject(original);
        await expect(action).rejects.toBe(original);
        for (const next of kinds)
          await expect(fresh(flavor, next)).rejects.toBe(original);
        expect(requests).toHaveLength(count);
        expect(kills).toEqual([]);
        expect(spawns).toHaveLength(1);
      },
    );
    it("wakes a cancelled control waiter without claiming writer settlement", async () => {
      const held = await retired();
      const waiting = observed(compactContext(flavor, input(flavor)));
      await flush();
      await cancelTurn(flavor, "writer-drain");
      let retiredCaller = false;
      void waiting.catch(() => {
        retiredCaller = true;
      });
      await flush();
      expect(retiredCaller).toBe(true);
      await expect(waiting).rejects.toThrow(/retired/i);
      const count = requests.length;
      let done = false;
      const next = observed(
        sendTurn(flavor, input(flavor)).then(() => {
          done = true;
        }),
      );
      await flush();
      expect(done).toBe(false);
      expect(requests).toHaveLength(count);
      held.resolve();
      await next;
    });
    it("wakes a detached waiter and lets a replacement work before A writer settles", async () => {
      const held = await retired();
      const waiting = observed(compactContext(flavor, input(flavor)));
      await flush();
      await stopSession(flavor, "writer-drain");
      let done = false;
      void waiting.catch(() => {
        done = true;
      });
      await flush();
      expect(done).toBe(true);
      await expect(waiting).rejects.toThrow(/retired/i);
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(2);
      held.resolve();
      await flush();
      await sendTurn(flavor, input(flavor));
    });
    it("excludes post-cancel abort writers even after another cancellation", async () => {
      await sendTurn(flavor, input(flavor));
      const held = deferred();
      let used = false;
      intercept = (request) => {
        if (used || request.command.type !== "abort") return;
        used = true;
        reply(request);
        return held.promise;
      };
      await cancelTurn(flavor, "writer-drain");
      await cancelTurn(flavor, "writer-drain");
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(1);
      expect(kills).toEqual([]);
      held.resolve();
    });
    it("ignores wrong native exit and wakes on exact exit without joining old writer", async () => {
      const held = await retired();
      const waiting = observed(compactContext(flavor, input(flavor)));
      let done = false;
      void waiting.catch(() => {
        done = true;
      });
      await flush();
      listeners.get("harness-exit")?.({
        payload: { sessionId: spawns[0], pid: 124, code: 13 },
      });
      await flush();
      expect(done).toBe(false);
      listeners.get("harness-exit")?.({
        payload: { sessionId: spawns[0], pid: 123, code: 13 },
      });
      await flush();
      expect(done).toBe(true);
      await expect(waiting).rejects.toThrow(`${flavor.label} exited`);
      await sendTurn(flavor, input(flavor));
      held.reject(new Error("old exited writer failure"));
      await flush();
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(2);
    });
    it("shares capacity across warmed actors and stop cannot release actual pending writes", async () => {
      await sendTurn(flavor, input(flavor));
      await sendTurn(flavor, input(flavor, [], "sibling"));
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return deferred().promise;
      };
      for (let i = 0; i < 256; i++) await compactContext(flavor, input(flavor));
      await stopSession(flavor, "writer-drain");
      const count = requests.length;
      await expect(
        compactContext(flavor, input(flavor, [], "sibling")),
      ).rejects.toThrow("Pi RPC writer capacity exceeded");
      expect(requests).toHaveLength(count);
      expect(spawns).toHaveLength(2);
    });
    it("actual writer completion frees one slot despite all prior ACKs", async () => {
      await sendTurn(flavor, input(flavor));
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return deferred().promise;
      };
      for (let i = 0; i < 256; i++) await compactContext(flavor, input(flavor));
      const count = requests.length;
      outstanding[0]?.resolve();
      await flush();
      await compactContext(flavor, input(flavor));
      expect(requests).toHaveLength(count + 1);
      expect(kills).toEqual([]);
    });
    it.each(
      Array.from({ length: 12 }, (_, tick) => tick).flatMap((tick) =>
        (["prompt", "compact"] as const).map((kind) => ({ tick, kind })),
      ),
    )(
      "keeps both sinks muted across drain/caller cancellation, tick=$tick kind=$kind",
      async ({ tick, kind }) => {
        const previous: HarnessEvent[] = [];
        const events: HarnessEvent[] = [];
        await sendTurn(flavor, input(flavor, previous));
        const held = holdOne();
        await compactContext(flavor, input(flavor, previous));
        await cancelTurn(flavor, "writer-drain");
        const queued = observed(fresh(flavor, kind, events));
        await flush();
        held.resolve();
        const cancellation = observed(
          (async () => {
            for (let i = 0; i < tick; i++) await Promise.resolve();
            await cancelTurn(flavor, "writer-drain");
          })(),
        );
        await cancellation;
        await queued.catch((error: unknown) =>
          expect(error).toMatchObject({ message: "Pi operation was retired." }),
        );
        await flush();
        const oldCount = previous.length;
        const newCount = events.length;
        frame(spawns[0] ?? "missing", { type: "compaction_start" });
        expect(previous).toHaveLength(oldCount);
        expect(events).toHaveLength(newCount);
      },
    );
    it("shares the writer limit across pi and omp actors", async () => {
      const other = flavor.id === "pi" ? OMP_FLAVOR : PI_FLAVOR;
      await sendTurn(flavor, input(flavor));
      await sendTurn(other, input(other, [], "sibling"));
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return deferred().promise;
      };
      for (let i = 0; i < 256; i++) await compactContext(flavor, input(flavor));
      const count = requests.length;
      await expect(
        compactContext(other, input(other, [], "sibling")),
      ).rejects.toThrow("Pi RPC writer capacity exceeded");
      expect(requests).toHaveLength(count);
      expect(kills).toEqual([]);
    });
    it("retains same-generation ACK completion without an extra drain boundary", async () => {
      await sendTurn(flavor, input(flavor));
      const held = holdOne();
      await compactContext(flavor, input(flavor));
      await sendTurn(flavor, input(flavor));
      held.resolve();
      expect(spawns).toHaveLength(1);
      expect(kills).toEqual([]);
    });
    it("does not wait on A retired writer when using a warmed sibling", async () => {
      await sendTurn(flavor, input(flavor, [], "sibling"));
      const held = await retired();
      await sendTurn(flavor, input(flavor, [], "sibling"));
      expect(spawns).toHaveLength(2);
      expect(kills).toEqual([]);
      held.resolve();
    });
    it("rejects before the 257th actual pending writer and retains capacity error", async () => {
      await sendTurn(flavor, input(flavor));
      intercept = (request) => {
        if (request.command.type !== "compact") return;
        reply(request);
        return deferred().promise;
      };
      for (let i = 0; i < 256; i++) await compactContext(flavor, input(flavor));
      const count = requests.length;
      const error = await compactContext(flavor, input(flavor)).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toMatchObject({
        message: "Pi RPC writer capacity exceeded",
      });
      expect(requests).toHaveLength(count);
      await expect(sendTurn(flavor, input(flavor))).rejects.toBe(error);
      expect(kills).toEqual([]);
    });
  },
);
