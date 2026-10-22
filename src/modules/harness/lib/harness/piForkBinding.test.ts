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
type State = { providerId: string; forks: number };
const states = new Map<string, State>();
const requests: Request[] = [];
const spawns: { nativeId: string; args: string[] }[] = [];
const executions: { nativeId: string; type: unknown; providerId: string }[] =
  [];
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
function state(nativeId: string) {
  const value = states.get(nativeId);
  if (!value) throw new Error("Expected captured native session");
  return value;
}
function frame(nativeId: string, value: Record<string, unknown>) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: nativeId, line: JSON.stringify(value) },
  });
}
function reply(
  request: Request,
  success = true,
  supplied?: Record<string, unknown>,
) {
  const current = state(request.nativeId);
  if (
    success &&
    request.command.type === "fork" &&
    supplied?.cancelled !== true
  ) {
    current.forks++;
    current.providerId = `fork_${request.nativeId}_${current.forks}`;
  }
  const data =
    supplied ??
    (request.command.type === "get_state"
      ? { sessionId: current.providerId }
      : request.command.type === "get_fork_messages"
        ? { messages: [{ entryId: "e1", text: "first" }] }
        : {});
  frame(request.nativeId, {
    type: "response",
    id: request.command.id,
    command: request.command.type,
    success,
    error: success ? undefined : `${request.command.type} rejected`,
    data,
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
    if (!captured) throw new Error("Expected held fork stage");
    return captured;
  };
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  sessionId = "fork-binding",
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
const freshKinds = ["prompt", "compact", "rewind"] as const;
function fresh(
  flavor: PiFlavor,
  kind: (typeof freshKinds)[number],
  events: HarnessEvent[] = [],
) {
  const request = input(flavor, events);
  return kind === "prompt"
    ? sendTurn(flavor, request)
    : kind === "compact"
      ? compactContext(flavor, request)
      : rewindLastTurn(flavor, request);
}
async function expectBlocked(
  flavor: PiFlavor,
  kind: (typeof freshKinds)[number],
) {
  const written = requests.length;
  const executed = executions.length;
  const events: HarnessEvent[] = [];
  const error = await fresh(flavor, kind, events).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toMatchObject({
    message: "Pi session identity was not confirmed after fork",
  });
  for (const next of freshKinds)
    await expect(fresh(flavor, next)).rejects.toBe(error);
  expect(requests).toHaveLength(written);
  expect(executions).toHaveLength(executed);
  expect(events).toEqual([]);
  expect(kills).toEqual([]);
  expect(spawns).toHaveLength(1);
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
        const at = argv.findIndex(
          (value) => value === "--session" || value === "--resume",
        );
        spawns.push({ nativeId, args: argv });
        states.set(nativeId, {
          providerId: at < 0 ? `original_${nativeId}` : argv[at + 1],
          forks: 0,
        });
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
        )
          executions.push({
            nativeId,
            type: request.command.type,
            providerId: state(nativeId).providerId,
          });
        reply(request);
        if (request.command.type === "prompt")
          frame(nativeId, { type: "agent_settled" });
      }
      return undefined as T;
    },
    async listen<T>(event: string, handler: (event: { payload: T }) => void) {
      listeners.set(event, handler as (event: { payload: unknown }) => void);
      return () => listeners.delete(event);
    },
  });
  release = await child.acquireHarnessBridge();
});
afterAll(() => release?.());
beforeEach(() => {
  states.clear();
  requests.length = 0;
  spawns.length = 0;
  executions.length = 0;
  kills.length = 0;
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  intercept = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["fork-binding", "sibling"])
      await forgetSession(flavor, id);
});
describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id fork binding uncertainty",
  (flavor) => {
    async function retired(
      type: string,
      success = true,
      gap = false,
      data?: Record<string, unknown>,
    ) {
      const captured = hold(type);
      const action = observed(rewindLastTurn(flavor, input(flavor)));
      await flush();
      if (gap) {
        reply(captured(), success, data);
        await Promise.resolve().then(() =>
          Promise.resolve().then(() => cancelTurn(flavor, "fork-binding")),
        );
      } else {
        await cancelTurn(flavor, "fork-binding");
        reply(captured(), success, data);
      }
      await expect(action).rejects.toThrow(
        gap && !success ? `${type} rejected` : /retired/i,
      );
      intercept = undefined;
    }
    it.each(freshKinds)(
      "blocks fresh %s after retired successful fork ACK",
      async (kind) => {
        await sendTurn(flavor, input(flavor));
        const original = state(spawns[0].nativeId).providerId;
        await retired("fork");
        expect(state(spawns[0].nativeId).providerId).not.toBe(original);
        await expectBlocked(flavor, kind);
      },
    );
    it.each(["fork", "get_state"])(
      "blocks after %s ACK in the helper-to-owning-caller gap",
      async (type) => {
        await sendTurn(flavor, input(flavor));
        await retired(type, true, true);
        await expectBlocked(flavor, "prompt");
      },
    );
    it("blocks when get_state is retired after successful fork", async () => {
      await sendTurn(flavor, input(flavor));
      await retired("get_state");
      await expectBlocked(flavor, "compact");
    });
    it("does not trust a rebound cache after provider-bound callback cancellation", async () => {
      await sendTurn(flavor, input(flavor));
      const request = input(flavor);
      request.onEvent = (event) => {
        if (event.type === "session.providerBound")
          void observed(cancelTurn(flavor, "fork-binding"));
      };
      await expect(rewindLastTurn(flavor, request)).rejects.toThrow(/retired/i);
      await flush();
      await expectBlocked(flavor, "rewind");
    });
    it.each([{}, { sessionId: "/private/path" }, { sessionId: " " }])(
      "keeps invalid fork identity blocked, state=%j",
      async (data) => {
        await sendTurn(flavor, input(flavor));
        intercept = (request) => {
          if (request.command.type !== "get_state") return false;
          reply(request, true, data);
          return true;
        };
        await expect(rewindLastTurn(flavor, input(flavor))).rejects.toThrow(
          "Pi did not expose the forked session",
        );
        intercept = undefined;
        await expectBlocked(flavor, "prompt");
      },
    );
    it("keeps owning get_state NACK rejection unchanged but blocks later execution", async () => {
      await sendTurn(flavor, input(flavor));
      intercept = (request) => {
        if (request.command.type !== "get_state") return false;
        reply(request, false);
        return true;
      };
      await expect(rewindLastTurn(flavor, input(flavor))).rejects.toThrow(
        "get_state rejected",
      );
      intercept = undefined;
      await expectBlocked(flavor, "prompt");
    });
    it.each([false, true])(
      "preserves non-mutating fork NACK rejection around cancellation, gap=%s",
      async (gap) => {
        await sendTurn(flavor, input(flavor));
        const original = state(spawns[0].nativeId).providerId;
        await retired("fork", false, gap);
        await sendTurn(flavor, input(flavor));
        expect(executions[executions.length - 1]?.providerId).toBe(original);
        expect(spawns).toHaveLength(1);
        expect(kills).toEqual([]);
      },
    );
    it.each([false, true])(
      "does not block a retired explicitly cancelled fork ACK, gap=%s",
      async (gap) => {
        await sendTurn(flavor, input(flavor));
        const original = state(spawns[0].nativeId).providerId;
        await retired("fork", true, gap, { cancelled: true });
        await sendTurn(flavor, input(flavor));
        expect(executions[executions.length - 1]?.providerId).toBe(original);
        expect(spawns).toHaveLength(1);
      },
    );
    it("preserves ordinary explicit fork cancellation and normal future reuse", async () => {
      await sendTurn(flavor, input(flavor));
      intercept = (request) => {
        if (request.command.type !== "fork") return false;
        reply(request, true, { cancelled: true });
        return true;
      };
      await expect(rewindLastTurn(flavor, input(flavor))).rejects.toThrow(
        "Edit cancelled",
      );
      intercept = undefined;
      await sendTurn(flavor, input(flavor));
      expect(kills).toEqual([]);
    });
    it("keeps a fully bound rewind healthy and resumes its confirmed native identity", async () => {
      await sendTurn(flavor, input(flavor));
      const events: HarnessEvent[] = [];
      await expect(
        rewindLastTurn(flavor, input(flavor, events)),
      ).resolves.toEqual({ submitted: false });
      const confirmed = state(spawns[0].nativeId).providerId;
      expect(events).toContainEqual({
        type: "session.providerBound",
        providerSessionId: confirmed,
      });
      const reads = requests.filter(
        (row) => row.command.type === "get_state",
      ).length;
      await sendTurn(flavor, input(flavor));
      await compactContext(flavor, input(flavor));
      expect(
        requests.filter((row) => row.command.type === "get_state"),
      ).toHaveLength(reads);
      expect(executions[executions.length - 1]?.providerId).toBe(confirmed);
      await stopSession(flavor, "fork-binding");
      await sendTurn(flavor, input(flavor));
      expect(spawns[1].args).toContain(confirmed);
      expect(executions[executions.length - 1]?.providerId).toBe(confirmed);
    });
    it("leaves a warmed sibling usable while A waits for its fork ACK", async () => {
      await sendTurn(flavor, input(flavor));
      await sendTurn(flavor, input(flavor, [], "sibling"));
      const captured = hold("fork");
      const action = observed(rewindLastTurn(flavor, input(flavor)));
      await flush();
      await sendTurn(flavor, input(flavor, [], "sibling"));
      await cancelTurn(flavor, "fork-binding");
      reply(captured());
      await expect(action).rejects.toThrow(/retired/i);
      intercept = undefined;
      await compactContext(flavor, input(flavor, [], "sibling"));
      expect(executions[executions.length - 1]).toMatchObject({
        nativeId: spawns[1].nativeId,
        providerId: state(spawns[1].nativeId).providerId,
      });
      expect(kills).toEqual([]);
    });
    it.each([false, true])(
      "cannot block a replacement from old fork ACK, fulfilled-before-retirement=%s",
      async (fulfilled) => {
        await sendTurn(flavor, input(flavor));
        const captured = hold("fork");
        const action = observed(rewindLastTurn(flavor, input(flavor)));
        await flush();
        if (fulfilled) reply(captured());
        await stopSession(flavor, "fork-binding");
        await expect(action).rejects.toThrow(/retired/i);
        intercept = undefined;
        await sendTurn(flavor, input(flavor));
        if (!fulfilled) reply(captured());
        await flush();
        await sendTurn(flavor, input(flavor));
        expect(spawns).toHaveLength(2);
        expect(executions[executions.length - 1]?.providerId).toBe(
          state(spawns[1].nativeId).providerId,
        );
      },
    );
  },
);
