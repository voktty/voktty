import * as child from "@/modules/harness/lib/harness/child";
import {
  cancelTurn,
  compactContext,
  forgetSession,
  rewindLastTurn,
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
  vi,
} from "vitest";

type Request = { nativeId: string; command: Record<string, unknown> };
const requests: Request[] = [];
const spawns: string[] = [];
const kills: string[] = [];
const held: Request[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let autoPrompt = true;
let holdSteer = false;
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
  frame(request.nativeId, {
    type: "response",
    id: request.command.id,
    command: request.command.type,
    success,
    error: success ? undefined : "steer rejected",
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
  sessionId = "outcome",
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
async function active(flavor: PiFlavor, id = "outcome") {
  autoPrompt = true;
  await sendTurn(flavor, input(flavor, [], id));
  autoPrompt = false;
  const turn = observed(sendTurn(flavor, input(flavor, [], id)));
  await flush();
  return { turn };
}
async function retired(flavor: PiFlavor) {
  const { turn } = await active(flavor);
  holdSteer = true;
  const steer = observed(steerTurn(flavor, input(flavor)));
  await flush();
  const request = held[held.length - 1];
  if (!request) throw new Error("Expected held steer");
  await cancelTurn(flavor, "outcome");
  await turn;
  autoPrompt = true;
  return { steer, request };
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
        if (
          holdSteer &&
          (request.command.type === "steer" ||
            request.command.streamingBehavior === "steer")
        ) {
          held.push(request);
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
  kills.length = 0;
  held.length = 0;
  autoPrompt = true;
  holdSteer = false;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  holdSteer = false;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["outcome", "sibling"]) await forgetSession(flavor, id);
  await flush();
  vi.useRealTimers();
});
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id retired steer outcome drain",
  (flavor) => {
    it.each(
      kinds.flatMap((kind) =>
        [true, false].map((success) => ({ kind, success })),
      ),
    )(
      "holds new $kind before old steer ACK, success=$success",
      async ({ kind, success }) => {
        const { steer, request } = await retired(flavor);
        const count = requests.length;
        const events: HarnessEvent[] = [];
        let done = false;
        const next = observed(
          fresh(flavor, kind, events).then(() => {
            done = true;
          }),
        );
        await flush();
        expect(done).toBe(false);
        expect(requests).toHaveLength(count);
        expect(events).toEqual([]);
        expect(kills).toEqual([]);
        reply(request, success);
        await expect(steer).rejects.toThrow(/retired/i);
        await next;
        expect(requests.length).toBeGreaterThan(count);
        expect(spawns).toHaveLength(1);
      },
    );
    it("wakes a cancelled FIFO waiter but does not release another generation before ACK", async () => {
      const { steer, request } = await retired(flavor);
      const first = observed(compactContext(flavor, input(flavor)));
      await flush();
      await cancelTurn(flavor, "outcome");
      let ended = false;
      void first.catch(() => {
        ended = true;
      });
      await flush();
      expect(ended).toBe(true);
      await expect(first).rejects.toThrow(/retired/i);
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
      reply(request);
      await expect(steer).rejects.toThrow(/retired/i);
      await next;
    });
    it("detaches a waiter and lets replacement run before old response", async () => {
      const { steer, request } = await retired(flavor);
      const next = observed(compactContext(flavor, input(flavor)));
      await flush();
      await stopSession(flavor, "outcome");
      let ended = false;
      void next.catch(() => {
        ended = true;
      });
      await flush();
      expect(ended).toBe(true);
      await expect(next).rejects.toThrow(/retired/i);
      await expect(steer).rejects.toThrow(/retired/i);
      holdSteer = false;
      await sendTurn(flavor, input(flavor));
      const count = requests.length;
      reply(request, false);
      await flush();
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(2);
      expect(requests.length).toBeGreaterThan(count);
    });
    it("retains uncertain timeout as one original error before allowing new native work", async () => {
      const { turn } = await active(flavor);
      vi.useFakeTimers();
      holdSteer = true;
      const steer = observed(steerTurn(flavor, input(flavor)));
      await flush();
      await cancelTurn(flavor, "outcome");
      await turn;
      autoPrompt = true;
      const count = requests.length;
      const next = observed(compactContext(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(15000);
      const original = await next.then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(original).toMatchObject({
        message: `${flavor.label} steer timed out`,
      });
      await expect(steer).rejects.toThrow(/retired/i);
      for (const kind of kinds)
        await expect(fresh(flavor, kind)).rejects.toBe(original);
      expect(requests).toHaveLength(count);
      expect(kills).toEqual([]);
    });
    it("keeps a warmed sibling usable while A old ACK is held", async () => {
      autoPrompt = true;
      await sendTurn(flavor, input(flavor, [], "sibling"));
      const { steer, request } = await retired(flavor);
      await sendTurn(flavor, input(flavor, [], "sibling"));
      expect(spawns).toHaveLength(2);
      expect(kills).toEqual([]);
      reply(request);
      await expect(steer).rejects.toThrow(/retired/i);
    });
    it("keeps same-generation steering concurrent and a NACK does not poison actor", async () => {
      const { turn } = await active(flavor);
      holdSteer = true;
      const first = observed(steerTurn(flavor, input(flavor)));
      const second = observed(steerTurn(flavor, input(flavor)));
      await flush();
      expect(held).toHaveLength(2);
      const a = held[0];
      const b = held[1];
      if (!a || !b) throw new Error("Expected concurrent steer receipts");
      reply(a, false);
      await expect(first).rejects.toThrow("steer rejected");
      reply(b);
      await second;
      holdSteer = false;
      await steerTurn(flavor, input(flavor));
      frame(spawns[0] ?? "missing", { type: "agent_settled" });
      await turn;
      expect(kills).toEqual([]);
    });
    it("shares 256 logical slots across flavors and refuses before 257th RPC without poisoning", async () => {
      const other = flavor.id === "pi" ? OMP_FLAVOR : PI_FLAVOR;
      const a = await active(flavor);
      const b = await active(other, "sibling");
      holdSteer = true;
      const pending: Promise<void>[] = [];
      for (let i = 0; i < 128; i++) {
        pending.push(observed(steerTurn(flavor, input(flavor))));
        pending.push(observed(steerTurn(other, input(other, [], "sibling"))));
      }
      await flush();
      const count = requests.length;
      const refused = observed(steerTurn(other, input(other, [], "sibling")));
      await flush();
      expect(requests).toHaveLength(count);
      await expect(refused).rejects.toThrow(
        "Pi steer outcome capacity exceeded",
      );
      expect(kills).toEqual([]);
      const first = held[0];
      if (!first) throw new Error("Expected held first");
      reply(first);
      await pending[0];
      const resumed = observed(steerTurn(other, input(other, [], "sibling")));
      await flush();
      expect(requests).toHaveLength(count + 1);
      for (const request of held) reply(request);
      await Promise.all(pending);
      await resumed;
      frame(spawns[0] ?? "missing", { type: "agent_settled" });
      frame(spawns[1] ?? "missing", { type: "agent_settled" });
      await a.turn;
      await b.turn;
    });
    it.each(
      Array.from({ length: 10 }, (_, tick) => tick).flatMap((tick) =>
        (["prompt", "compact"] as const).map((kind) => ({ tick, kind })),
      ),
    )(
      "keeps retired sinks muted across outcome/helper/caller gaps, tick=$tick kind=$kind",
      async ({ tick, kind }) => {
        const { steer, request } = await retired(flavor);
        const events: HarnessEvent[] = [];
        const next = observed(fresh(flavor, kind, events));
        await flush();
        reply(request);
        const cancellation = observed(
          (async () => {
            for (let i = 0; i < tick; i++) await Promise.resolve();
            await cancelTurn(flavor, "outcome");
          })(),
        );
        await cancellation;
        await next.catch((error: unknown) =>
          expect(error).toMatchObject({ message: "Pi operation was retired." }),
        );
        await expect(steer).rejects.toThrow(/retired/i);
        await flush();
        const count = events.length;
        frame(spawns[0] ?? "missing", { type: "compaction_start" });
        expect(events).toHaveLength(count);
      },
    );
  },
);
async function completedWithSteer(flavor: PiFlavor) {
  const { turn } = await active(flavor);
  holdSteer = true;
  const steer = observed(steerTurn(flavor, input(flavor)));
  await flush();
  const request = held[held.length - 1];
  if (!request) throw new Error("Expected completed-turn steer");
  frame(request.nativeId, { type: "agent_settled" });
  await turn;
  autoPrompt = true;
  return { steer, request };
}

describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id completed turn steer admission",
  (flavor) => {
    it.each(
      kinds.flatMap((kind) =>
        [true, false].map((success) => ({ kind, success })),
      ),
    )(
      "waits for same-token steer before next $kind, success=$success",
      async ({ kind, success }) => {
        const { steer, request } = await completedWithSteer(flavor);
        const count = requests.length;
        const events: HarnessEvent[] = [];
        let done = false;
        const next = observed(
          fresh(flavor, kind, events).then(() => {
            done = true;
          }),
        );
        await flush();
        expect(done).toBe(false);
        expect(requests).toHaveLength(count);
        expect(events).toEqual([]);
        reply(request, success);
        if (success) await steer;
        else await expect(steer).rejects.toThrow("steer rejected");
        await next;
        expect(spawns).toHaveLength(1);
        expect(kills).toEqual([]);
      },
    );
    it("does not admit next work after only one of two same-token ACKs", async () => {
      const { turn } = await active(flavor);
      holdSteer = true;
      const first = observed(steerTurn(flavor, input(flavor)));
      const second = observed(steerTurn(flavor, input(flavor)));
      await flush();
      const a = held[0];
      const b = held[1];
      if (!a || !b) throw new Error("Expected two same-token requests");
      frame(a.nativeId, { type: "agent_settled" });
      await turn;
      autoPrompt = true;
      const count = requests.length;
      const next = observed(compactContext(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      reply(a);
      await first;
      await flush();
      expect(requests).toHaveLength(count);
      reply(b);
      await second;
      await next;
    });
    it("blocks both old same-token steer and waiting work with the exact uncertain timeout", async () => {
      const { turn } = await active(flavor);
      vi.useFakeTimers();
      holdSteer = true;
      const steer = observed(steerTurn(flavor, input(flavor)));
      await flush();
      const request = held[0];
      if (!request) throw new Error("Expected timeout request");
      frame(request.nativeId, { type: "agent_settled" });
      await turn;
      autoPrompt = true;
      const count = requests.length;
      const next = observed(compactContext(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(15000);
      const original = await steer.then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(original).toMatchObject({
        message: `${flavor.label} steer timed out`,
      });
      await expect(next).rejects.toBe(original);
      for (const kind of kinds)
        await expect(fresh(flavor, kind)).rejects.toBe(original);
      expect(requests).toHaveLength(count);
      expect(kills).toEqual([]);
    });
    it("cancels same-token FIFO waiters without freeing the unresolved result", async () => {
      const { steer, request } = await completedWithSteer(flavor);
      const first = observed(compactContext(flavor, input(flavor)));
      await flush();
      await cancelTurn(flavor, "outcome");
      await expect(first).rejects.toThrow(/retired/i);
      const count = requests.length;
      const next = observed(sendTurn(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      reply(request);
      await expect(steer).rejects.toThrow(/retired/i);
      await next;
    });
    it("stops same-token waiters and replaces the actor without requiring its old ACK", async () => {
      const { steer, request } = await completedWithSteer(flavor);
      const next = observed(compactContext(flavor, input(flavor)));
      await flush();
      await stopSession(flavor, "outcome");
      await expect(next).rejects.toThrow(/retired/i);
      await expect(steer).rejects.toThrow(/retired/i);
      holdSteer = false;
      await sendTurn(flavor, input(flavor));
      reply(request, false);
      await flush();
      await sendTurn(flavor, input(flavor));
      expect(spawns).toHaveLength(2);
    });
    it("does not configure model or accept the next turn before the preceding steer outcome", async () => {
      const { steer, request } = await completedWithSteer(flavor);
      const events: HarnessEvent[] = [];
      let accepted = 0;
      const count = requests.length;
      const next = observed(
        sendTurn(flavor, {
          ...input(flavor, events),
          model: `${flavor.id}:anthropic/new-model`,
          modelSettings: { thinking: "high" },
          onAccepted: () => {
            accepted += 1;
          },
        }),
      );
      await flush();
      expect(requests).toHaveLength(count);
      expect(events).toEqual([]);
      expect(accepted).toBe(0);
      reply(request);
      await steer;
      await next;
      expect(accepted).toBe(1);
      expect(
        requests.slice(count).some((row) => row.command.type === "set_model"),
      ).toBe(true);
    });
    it("keeps an unrelated warmed actor available while same-token work waits", async () => {
      autoPrompt = true;
      await sendTurn(flavor, input(flavor, [], "sibling"));
      const { steer, request } = await completedWithSteer(flavor);
      const count = requests.length;
      const next = observed(compactContext(flavor, input(flavor)));
      await flush();
      expect(requests).toHaveLength(count);
      await sendTurn(flavor, input(flavor, [], "sibling"));
      expect(spawns).toHaveLength(2);
      reply(request);
      await steer;
      await next;
      expect(kills).toEqual([]);
    });
  },
);

describe("omp streaming steer command", () => {
  it("tracks slash prompt routed through concurrent steering", async () => {
    const { turn } = await active(OMP_FLAVOR);
    holdSteer = true;
    const steer = observed(
      steerTurn(OMP_FLAVOR, { ...input(OMP_FLAVOR), text: "/guide" }),
    );
    await flush();
    const request = held[0];
    expect(request?.command.streamingBehavior).toBe("steer");
    if (!request) throw new Error("Expected slash steer");
    await cancelTurn(OMP_FLAVOR, "outcome");
    await turn;
    autoPrompt = true;
    const count = requests.length;
    const next = observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR)));
    await flush();
    expect(requests).toHaveLength(count);
    reply(request);
    await expect(steer).rejects.toThrow(/retired/i);
    await next;
  });
});
