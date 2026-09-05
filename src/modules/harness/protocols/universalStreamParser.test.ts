import { describe, expect, it } from "vitest";
import { UniversalStreamParser } from "./universalStreamParser";
import type { HarnessEvent } from "../types";

describe("UniversalStreamParser", () => {
  it("parses thinking tags <think> and </think>", () => {
    const events: HarnessEvent[] = [];
    const parser = new UniversalStreamParser((e) => events.push(e));

    parser.feedLine("<think>");
    parser.feedLine("Let me analyze the problem first.");
    parser.feedLine("</think>");
    parser.feedLine("Here is the solution to your issue.");

    expect(events).toEqual([
      { type: "reasoning.delta", text: "Let me analyze the problem first.\n" },
      { type: "reasoning.completed" },
      { type: "message.delta", text: "Here is the solution to your issue.\n" },
    ]);
  });

  it("parses tool call XML tags <tool_call>", () => {
    const events: HarnessEvent[] = [];
    const parser = new UniversalStreamParser((e) => events.push(e));

    parser.feedLine('<tool_call>{"name": "bash", "arguments": {"command": "cargo check"}}</tool_call>');

    expect(events.length).toBeGreaterThanOrEqual(1);
    const toolEvent = events.find((e) => e.type === "tool.started");
    expect(toolEvent).toBeDefined();
    if (toolEvent && toolEvent.type === "tool.started") {
      expect(toolEvent.title).toContain("bash");
      expect(toolEvent.preview?.command).toBe("cargo check");
    }
  });

  it("parses Claude-style JSON streaming lines", () => {
    const events: HarnessEvent[] = [];
    const parser = new UniversalStreamParser((e) => events.push(e));

    parser.feedLine(
      JSON.stringify({
        type: "content_block_delta",
        delta: { text: "Hello from Claude agent!" },
      }),
    );

    expect(events).toEqual([
      { type: "message.delta", text: "Hello from Claude agent!" },
    ]);
  });

  it("parses Codex-style JSON streaming lines", () => {
    const events: HarnessEvent[] = [];
    const parser = new UniversalStreamParser((e) => events.push(e));

    parser.feedLine(
      JSON.stringify({
        method: "turn/update",
        params: { delta: "Codex update line." },
      }),
    );

    expect(events).toEqual([
      { type: "message.delta", text: "Codex update line." },
    ]);
  });

  it("strips ANSI terminal escape codes from raw lines", () => {
    const events: HarnessEvent[] = [];
    const parser = new UniversalStreamParser((e) => events.push(e));

    parser.feedLine("\u001b[32mSuccess:\u001b[0m All tests passed");

    expect(events).toEqual([
      { type: "message.delta", text: "Success: All tests passed\n" },
    ]);
  });
});
