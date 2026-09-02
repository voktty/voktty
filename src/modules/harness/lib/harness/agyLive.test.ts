import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "./types";

const writes: string[] = [];
const spawns: Array<{ command: string; args: string[]; cwd: string }> = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("./child", () => ({
  resolveGeminiBinary: async () => ({ path: "/fake/agy" }),
  spawnChild: async (
    _id: string,
    command: string,
    args: string[],
    cwd: string,
  ) => {
    spawns.push({ command, args, cwd });
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    writes.push(line);
  },
}));

const {
  __agyTestReset,
  buildAgySpawnArgs,
  parseAgyLine,
  sendAgyTurn,
  stopAgySession,
} = await import("./agy");

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

function input(
  text: string,
  events: HarnessEvent[],
  runtimeMode: "supervised" | "full-access" | "plan" = "supervised",
): SendTurnInput {
  return {
    sessionId: "agy-live",
    cwd: "/repo",
    model: "gemini:gemini-3.7-flash",
    modelSettings: { effort: "high" },
    runtimeMode,
    text,
    attachments: [],
    onEvent: (event: HarnessEvent) => events.push(event),
  };
}

describe("Antigravity live stream", () => {
  beforeEach(() => {
    writes.length = 0;
    spawns.length = 0;
    onLine = undefined;
  });

  afterEach(async () => {
    await stopAgySession("agy-live");
    __agyTestReset();
  });

  it("uses a persistent JSON stream for consecutive turns", async () => {
    const events: HarnessEvent[] = [];
    const first = sendAgyTurn(input("inspect the repository", events));
    await waitFor(() => writes.length === 1, "first user event");

    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.args).toEqual([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      "gemini-3.7-flash-high",
      "--effort",
      "high",
      "--mode",
      "accept-edits",
    ]);
    expect(JSON.parse(writes[0] ?? "{}")).toEqual({
      event: "user",
      message: { content: "inspect the repository" },
    });

    onLine?.(
      JSON.stringify({
        event: "init",
        conversation_id: "conversation-1",
      }),
    );
    onLine?.(
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          text_delta: "Done",
        },
      }),
    );
    onLine?.(
      JSON.stringify({
        event: "result",
        status: "SUCCESS",
        response: "Done",
        usage: { total_tokens: 42 },
      }),
    );
    await first;

    const second = sendAgyTurn(input("continue", events));
    await waitFor(() => writes.length === 2, "second user event");
    expect(spawns).toHaveLength(1);
    onLine?.(JSON.stringify({ event: "result", status: "SUCCESS" }));
    await second;

    expect(
      events.filter((event) => event.type === "session.providerBound"),
    ).toEqual([
      {
        type: "session.providerBound",
        providerSessionId: "conversation-1",
      },
    ]);
    expect(events.filter((event) => event.type === "message.delta")).toEqual([
      { type: "message.delta", text: "Done" },
    ]);
    expect(events).toContainEqual({
      type: "context",
      used: 42,
      window: 1_000_000,
    });
  });

  it("only grants unrestricted permissions in full-access mode", () => {
    expect(buildAgySpawnArgs(input("", [], "full-access"))).toContain(
      "--dangerously-skip-permissions",
    );
    expect(buildAgySpawnArgs(input("", [], "plan"))).toContain("plan");
    expect(buildAgySpawnArgs(input("", [], "supervised"))).not.toContain(
      "--dangerously-skip-permissions",
    );
  });

  it("ignores non-JSON process noise", () => {
    expect(parseAgyLine("Starting Antigravity...")).toBeNull();
    expect(parseAgyLine('{"event":"init"}')).toEqual({ event: "init" });
  });
});
