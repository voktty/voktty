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
  forgetSession,
  sendTurn,
  setPiBinaryResolver,
} from "./piFamily";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import type { HarnessEvent, SendTurnInput } from "./types";

type Call = { command: string; args: Record<string, unknown> };
const calls: Call[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
const pids = new Map<string, number>();
let pid = 100;
let release: (() => void) | undefined;
let spawn: ((id: string) => Promise<void>) | undefined;
let kill: ((id: string) => Promise<void>) | undefined;
let stage:
  | ((id: string, command: Record<string, unknown>) => boolean)
  | undefined;
let autoPrompt = true;
function observed<T>(p: Promise<T>) {
  void p.catch(() => undefined);
  return p;
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function invokeCalls(command: string) {
  return calls.filter((c) => c.command === command);
}
function lastId() {
  const rows = invokeCalls("harness_spawn");
  return String(rows[rows.length - 1]?.args.sessionId);
}
function frame(id: string, value: Record<string, unknown>) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: id, line: JSON.stringify(value) },
  });
}
function response(
  id: string,
  command: Record<string, unknown>,
  data: unknown = {},
) {
  frame(id, {
    type: "response",
    id: command.id,
    command: command.type,
    success: true,
    data,
  });
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  text = "hello",
  sessionId = "owned-pi",
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:default`,
    runtimeMode: "supervised",
    text,
    onEvent: (e) => events.push(e),
  };
}
beforeAll(async () => {
  child.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      const id = String(args.sessionId);
      if (command === "harness_spawn") {
        const next = pid++;
        pids.set(id, next);
        await spawn?.(id);
        processes.set(id, next);
        return next as T;
      }
      if (command === "harness_kill") {
        await kill?.(id);
        processes.delete(id);
      }
      if (command === "harness_write") {
        const req = JSON.parse(String(args.line));
        if (stage?.(id, req)) return undefined as T;
        if (req.type === "extension_ui_response") return undefined as T;
        response(
          id,
          req,
          req.type === "get_state"
            ? {
                sessionId: `provider_${id.replace(/-/g, "_")}`,
                thinkingLevel: "off",
              }
            : req.type === "get_fork_messages"
              ? { messages: [{ entryId: "entry", text: "old" }] }
              : req.type === "compact"
                ? { estimatedTokensAfter: 42 }
                : {},
        );
        if (req.type === "prompt" && autoPrompt)
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
  calls.length = 0;
  stage = undefined;
  spawn = undefined;
  kill = undefined;
  autoPrompt = true;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  stage = undefined;
  spawn = undefined;
  kill = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["owned-pi", "sibling", "mutated"])
      await forgetSession(flavor, id);
});

describe.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id model-operation cancellation",
  (flavor) => {
    it("same retained actor cancellation suppresses held model continuation", async () => {
      const warm = input(flavor);
      warm.modelSettings = { thinking: "off" };
      await observed(sendTurn(flavor, warm));
      const nativeId = lastId();
      let held: Record<string, unknown> | undefined;
      stage = (id, command) => {
        if (id === nativeId && command.type === "set_model") {
          held = command;
          return true;
        }
        return false;
      };
      const staleEvents: HarnessEvent[] = [];
      const request = input(flavor, staleEvents, "stale");
      request.model = `${flavor.id}:provider/new`;
      request.modelSettings = { thinking: "high" };
      let accepted = 0;
      request.onAccepted = () => accepted++;
      const action = observed(sendTurn(flavor, request));
      await flush();
      if (!held) throw new Error("Missing held model request");
      await cancelTurn(flavor, request.sessionId);
      const writesBefore = invokeCalls("harness_write").length;
      const eventsBefore = staleEvents.length;
      stage = undefined;
      response(nativeId, held);
      await action.catch(() => undefined);
      await flush();
      expect(invokeCalls("harness_write")).toHaveLength(writesBefore);
      expect(staleEvents).toHaveLength(eventsBefore);
      expect(accepted).toBe(0);
      expect(processes.has(nativeId)).toBe(true);
      expect(invokeCalls("harness_spawn")).toHaveLength(1);
    });
    it("snapshots queued high thinking and callback across a held model setter for only its owner", async () => {
      const events: HarnessEvent[] = [];
      const warm = input(flavor, events);
      warm.modelSettings = { thinking: "off" };
      warm.networkAllowlist = ["a.example"];
      await observed(sendTurn(flavor, warm));
      const old = lastId();
      const oldPid = pids.get(old);
      if (!oldPid || oldPid <= 0) throw new Error("Missing positive owner PID");
      let held: Record<string, unknown> | undefined;
      stage = (id, command) => {
        if (id === old && command.type === "set_model") {
          held = command;
          return true;
        }
        return false;
      };
      const req = input(flavor, events, "original");
      req.model = `${flavor.id}:provider/new`;
      req.modelSettings = { thinking: "high" };
      req.attachments = [
        {
          id: "image",
          name: "image",
          kind: "image",
          mimeType: "image/png",
          size: 1,
          data: "original",
        },
      ];
      const turn = observed(sendTurn(flavor, req));
      await flush();
      expect(held).toBeDefined();
      req.sessionId = "mutated";
      req.cwd = "/mutated";
      req.text = "mutated";
      req.modelSettings.thinking = "low";
      req.attachments[0].data = "mutated";
      const mutatedEvents: HarnessEvent[] = [];
      req.onEvent = (event) => mutatedEvents.push(event);
      stage = undefined;
      if (!held) throw new Error("Missing held model request");
      response(old, held);
      await turn;
      const commands = invokeCalls("harness_write")
        .filter((c) => c.args.sessionId === old)
        .map((c) => JSON.parse(String(c.args.line)));
      expect(commands).toContainEqual(
        expect.objectContaining({ type: "set_thinking_level", level: "high" }),
      );
      expect(commands).not.toContainEqual(
        expect.objectContaining({ type: "set_thinking_level", level: "low" }),
      );
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: "prompt",
          message: "original",
          images: [{ type: "image", mimeType: "image/png", data: "original" }],
        }),
      );
      expect(mutatedEvents).toEqual([]);
      expect(events.some((event) => event.type === "message.completed")).toBe(
        true,
      );
      await observed(sendTurn(flavor, input(flavor, [], "sibling", "sibling")));
      const sibling = lastId();
      expect(sibling).not.toBe(old);
      expect(
        invokeCalls("harness_write")
          .filter((c) => c.args.sessionId === sibling)
          .map((c) => JSON.parse(String(c.args.line))),
      ).not.toContainEqual(
        expect.objectContaining({ type: "set_thinking_level", level: "high" }),
      );
    });
    it("keeps a queued turn valid without replacing its predecessor event sink", async () => {
      autoPrompt = false;
      const firstEvents: HarnessEvent[] = [];
      const secondEvents: HarnessEvent[] = [];
      const first = observed(
        sendTurn(flavor, input(flavor, firstEvents, "first")),
      );
      await flush();
      const nativeId = lastId();
      const second = observed(
        sendTurn(flavor, input(flavor, secondEvents, "second")),
      );
      await flush();
      expect(
        invokeCalls("harness_write").filter(
          (c) => JSON.parse(String(c.args.line)).type === "prompt",
        ),
      ).toHaveLength(1);
      frame(nativeId, { type: "agent_settled" });
      await first;
      await flush();
      const firstCompleted = firstEvents.some(
        (event) => event.type === "message.completed",
      );
      const secondCompletedEarly = secondEvents.some(
        (event) => event.type === "message.completed",
      );
      frame(nativeId, { type: "agent_settled" });
      await second;
      expect(firstCompleted).toBe(true);
      expect(secondCompletedEarly).toBe(false);
      expect(
        invokeCalls("harness_write").filter(
          (c) => JSON.parse(String(c.args.line)).type === "prompt",
        ),
      ).toHaveLength(2);
    });
    it("does not adopt the cancellation generation across warm admission", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const request = input(flavor, [], "cancelled before admission resumes");
      let accepted = 0;
      request.onAccepted = () => accepted++;
      const before = invokeCalls("harness_write").filter(
        (c) => JSON.parse(String(c.args.line)).type === "prompt",
      ).length;
      const action = observed(sendTurn(flavor, request));
      const cancellation = observed(cancelTurn(flavor, request.sessionId));
      await Promise.all([action, cancellation]);
      expect(
        invokeCalls("harness_write").filter(
          (c) => JSON.parse(String(c.args.line)).type === "prompt",
        ),
      ).toHaveLength(before);
      expect(accepted).toBe(0);
      await observed(sendTurn(flavor, input(flavor, [], "later valid turn")));
      expect(
        invokeCalls("harness_write").filter(
          (c) => JSON.parse(String(c.args.line)).type === "prompt",
        ),
      ).toHaveLength(before + 1);
    });
    it("preserves current positive-PID exit rejection across warm admission", async () => {
      await observed(sendTurn(flavor, input(flavor)));
      const nativeId = lastId();
      const capturedPid = pids.get(nativeId);
      if (!capturedPid || capturedPid <= 0)
        throw new Error("Missing original positive PID");
      const action = observed(
        sendTurn(flavor, input(flavor, [], "must reject")),
      );
      listeners.get("harness-exit")?.({
        payload: { sessionId: nativeId, pid: capturedPid, code: 1 },
      });
      await expect(action).rejects.toThrow(`${flavor.label} exited`);
    });
    it("preserves the initial high-thinking handshake", async () => {
      const request = input(flavor);
      request.modelSettings = { thinking: "high" };
      await observed(sendTurn(flavor, request));
      expect(
        invokeCalls("harness_write").some(
          (c) => JSON.parse(String(c.args.line)).type === "set_thinking_level",
        ),
      ).toBe(false);
    });
  },
);

it("same retained OMP actor cancellation suppresses a late fast-mode failure fallback", async () => {
  const warm = input(OMP_FLAVOR);
  warm.modelSettings = { thinking: "off" };
  await observed(sendTurn(OMP_FLAVOR, warm));
  const nativeId = lastId();
  let held: Record<string, unknown> | undefined;
  stage = (id, command) => {
    if (id === nativeId && command.type === "set_fast_mode") {
      held = command;
      return true;
    }
    return false;
  };
  const staleEvents: HarnessEvent[] = [];
  const request = input(OMP_FLAVOR, staleEvents, "stale fast");
  request.modelSettings = { fast: "true" };
  const action = observed(sendTurn(OMP_FLAVOR, request));
  await flush();
  if (!held) throw new Error("Missing held fast-mode request");
  await cancelTurn(OMP_FLAVOR, request.sessionId);
  const writesBefore = invokeCalls("harness_write").length;
  const eventsBefore = staleEvents.length;
  stage = undefined;
  frame(nativeId, {
    type: "response",
    id: held.id,
    command: held.type,
    success: false,
    error: "late fast failure",
  });
  await action.catch(() => undefined);
  await flush();
  expect(invokeCalls("harness_write")).toHaveLength(writesBefore);
  expect(staleEvents).toHaveLength(eventsBefore);
  expect(processes.has(nativeId)).toBe(true);
  expect(invokeCalls("harness_spawn")).toHaveLength(1);
  const retry = input(OMP_FLAVOR, [], "valid fast retry");
  retry.modelSettings = { fast: "true" };
  await observed(sendTurn(OMP_FLAVOR, retry));
  expect(
    invokeCalls("harness_write").filter(
      (c) => JSON.parse(String(c.args.line)).type === "set_fast_mode",
    ),
  ).toHaveLength(2);
});
