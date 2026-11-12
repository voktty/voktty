import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, expect, it, vi } from "vitest";
import { runApiAgentLoop } from "./apiAgentLoop";

const io = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(async () => ({ kind: "text" as const, content: "original", size: 8 })),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));
import { apiToolContext, buildApiTools, forgetApiTools } from "./apiTools";

beforeEach(() => vi.clearAllMocks());

async function call(name: string, value: Record<string, unknown>) {
  const context = apiToolContext("api-tools-fixture", "/project", "fixture");
  if (!context) throw new Error("Missing context");
  let step = 0;
  const callId = crypto.randomUUID();
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      if (step++ === 0) {
        controller.enqueue({ type: "tool-input-start", id: callId, toolName: name });
        controller.enqueue({ type: "tool-call", toolCallId: callId, toolName: name, input: JSON.stringify(value) });
      }
      controller.enqueue({ type: "finish", usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 0, reasoning: 0 } }, finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined } });
      controller.close();
    },
  }) }) });
  return runApiAgentLoop({ model, messages: [{ role: "user", content: "Work" }], tools: buildApiTools(context), signal: new AbortController().signal, onEvent: () => {}, onApproval: async () => true });
}

it("reads and edits within the original project", async () => {
  await call("read_file", { path: "file.ts" });
  await call("edit", { path: "file.ts", old_string: "original", new_string: "changed" });
  expect(io.readFile).toHaveBeenCalledWith("/project/file.ts", { kind: "local" });
  expect(io.writeFile).toHaveBeenCalledWith("/project/file.ts", "changed", { kind: "local" });
  await forgetApiTools("api-tools-fixture");
});

it.each([
  ["read_file", "/outside/file.ts"],
  ["read_file", "/project/.env"],
  ["write_file", "/outside/file.ts"],
  ["write_file", "/project/.env"],
])("refuses %s at %s", async (name, path) => {
  const messages = await call(name, name === "write_file" ? { path, content: "secret" } : { path });
  expect(JSON.stringify(messages)).toContain("Refused");
  expect(io.readFile).not.toHaveBeenCalled();
  expect(io.writeFile).not.toHaveBeenCalled();
  await forgetApiTools("api-tools-fixture");
});
