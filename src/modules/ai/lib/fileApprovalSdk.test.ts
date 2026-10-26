import { streamText, tool, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { expect, it, vi } from "vitest";

const input = { path: "file.ts", content: "fixture" };
const serialized = JSON.stringify(input);
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 0, reasoning: 0 },
};

function model(withToolCall: boolean) {
  return new MockLanguageModelV4({
    doStream: {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (withToolCall) {
            controller.enqueue({
              type: "tool-input-start",
              id: "fixture-call",
              toolName: "write_file",
            });
            controller.enqueue({
              type: "tool-call",
              toolCallId: "fixture-call",
              toolName: "write_file",
              input: serialized,
            });
          }
          controller.enqueue({
            type: "finish",
            usage,
            finishReason: {
              unified: withToolCall ? "tool-calls" : "stop",
              raw: undefined,
            },
          });
          controller.close();
        },
      }),
    },
  });
}

it.each([true, false])(
  "retains the SDK approval boundary when tools are rebuilt (approved=%s)",
  async (approved) => {
    const events: string[] = [];
    const firstInput = vi.fn((_options: unknown) => {
      events.push("input");
    });
    const resumedInput = vi.fn((_options: unknown) => {
      events.push("resumed-input");
    });
    const execute = vi.fn(async (value: typeof input) => {
      events.push("execute");
      return { ok: true, path: value.path };
    });
    const tools = (onInputAvailable: (options: unknown) => void) => ({
      write_file: tool({
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        needsApproval: true,
        onInputAvailable,
        execute,
      }),
    });
    const messages: ModelMessage[] = [
      { role: "user", content: "Write the fixture file." },
    ];
    const first = streamText({
      model: model(true),
      tools: tools(firstInput),
      messages,
    });
    await first.consumeStream();
    const response = await first.response;
    const request = response.messages
      .flatMap((message) =>
        message.role === "assistant" && Array.isArray(message.content)
          ? message.content
          : [],
      )
      .find((part) => part.type === "tool-approval-request");
    if (request?.type !== "tool-approval-request")
      throw new Error("SDK did not request approval");
    expect(events).toEqual(["input"]);
    expect(firstInput).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "fixture-call",
        input,
      }),
    );
    expect(execute).not.toHaveBeenCalled();

    const resumed = streamText({
      model: model(false),
      tools: tools(resumedInput),
      messages: [
        ...messages,
        ...response.messages,
        {
          role: "tool",
          content: [
            {
              type: "tool-approval-response",
              approvalId: request.approvalId,
              approved,
            },
          ],
        },
      ],
    });
    const deniedIds: string[] = [];
    for await (const part of resumed.fullStream) {
      if (part.type === "tool-output-denied") deniedIds.push(part.toolCallId);
    }
    expect(resumedInput).not.toHaveBeenCalled();
    expect(events).toEqual(approved ? ["input", "execute"] : ["input"]);
    if (approved) {
      expect(deniedIds).toEqual([]);
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        input,
        expect.objectContaining({ toolCallId: "fixture-call" }),
      );
    } else {
      expect(execute).not.toHaveBeenCalled();
      expect(deniedIds).toEqual(["fixture-call"]);
    }
  },
);
