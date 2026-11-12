import { expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

const fixture = vi.hoisted(() => ({
  histories: [] as ModelMessage[][],
  tools: [] as unknown[],
  fail: false,
  release: vi.fn(),
  lease: null as null | { target: { root: string; workspace: { kind: "ssh" }; shell: boolean } },
}));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("@/modules/ai/lib/agent", () => ({ buildStableSystem: () => "system" }));
vi.mock("@/modules/harness/lib/harness/apiTools", () => ({
  localApiToolTarget: () => null,
  acquireRemoteApiTools: async () =>
    fixture.lease ? { ...fixture.lease, release: fixture.release } : null,
  apiToolContext: (_s: string, _c: string, _m: string, target: unknown) =>
    target ? { target } : null,
  buildApiTools: (_context: unknown, options: { shell?: boolean }) =>
    options.shell === false ? { read_file: {} } : { read_file: {}, bash_run: {} },
  forgetApiTools: async () => {},
}));
vi.mock("@/modules/harness/lib/harness/apiAgentLoop", () => ({
  runApiAgentLoop: async (input: { messages: ModelMessage[]; signal: AbortSignal; tools?: unknown }) => {
    fixture.histories.push(input.messages);
    fixture.tools.push(input.tools);
    if (fixture.fail) throw new Error("provider down");
    if (fixture.histories.length === 2) {
      await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
      return [];
    }
    return [{ role: "assistant", content: "answer" }];
  },
}));

import { cancelApiTurn, ensureApiRegistered, forgetApiSession, sendApiTurn } from "./apiAdapter";
import { sendHarnessTurn } from "./registry";
import type { HarnessEvent } from "./types";

it("does not keep a cancelled user turn in the next request", async () => {
  const input = { sessionId: "history-cancel", cwd: "/project", model: "fixture", runtimeMode: "supervised" as const, onEvent: () => {} };
  await sendApiTurn({ ...input, text: "first" });
  const pending = sendApiTurn({ ...input, text: "cancelled" });
  await vi.waitFor(() => expect(fixture.histories).toHaveLength(2));
  await cancelApiTurn(input.sessionId);
  await pending;
  await sendApiTurn({ ...input, text: "next" });
  expect(fixture.histories[2]).toEqual([
    { role: "user", content: "first" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "next" },
  ]);
  await forgetApiSession(input.sessionId);
});

it("allows an SSH conversation without exposing local tools and warns the user", async () => {
  ensureApiRegistered();
  const events: HarnessEvent[] = [];
  await sendHarnessTurn({ harness: "api", sessionId: "remote-conversation", cwd: "remote://ssh-host/srv/project", model: "fixture", runtimeMode: "supervised", text: "Hello", onEvent: (event) => events.push(event) });
  expect(fixture.tools[fixture.tools.length - 1]).toBeUndefined();
  expect(events).toContainEqual(expect.objectContaining({ type: "status", text: expect.stringContaining("SSH") }));
  await forgetApiSession("remote-conversation");
});

it("gives an SSH project file tools without a shell and releases its helper session", async () => {
  ensureApiRegistered();
  fixture.lease = { target: { root: "/srv/project", workspace: { kind: "ssh" }, shell: false } };
  const events: HarnessEvent[] = [];
  const input = { harness: "api" as const, sessionId: "remote-tools", cwd: "remote://ssh-host/srv/project", model: "fixture", runtimeMode: "supervised" as const, text: "Read", onEvent: (event: HarnessEvent) => events.push(event) };
  await sendHarnessTurn(input);
  expect(fixture.tools[fixture.tools.length - 1]).toEqual({ read_file: {} });
  expect(events).toContainEqual(expect.objectContaining({ type: "status", text: expect.stringContaining("commands") }));
  expect(fixture.release).toHaveBeenCalledOnce();

  fixture.fail = true;
  await expect(sendHarnessTurn(input)).rejects.toThrow("provider down");
  expect(fixture.release).toHaveBeenCalledTimes(2);
  fixture.fail = false;
  fixture.lease = null;
  await forgetApiSession("remote-tools");
});
