import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const { runCodexTextPrompt, stopCodexTextPrompt } = await import("./codexText");

type RpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
};

function messages(): RpcMessage[] {
  return sent.map((line) => JSON.parse(line) as RpcMessage);
}

function request(method: string): RpcMessage | undefined {
  return messages().find((message) => message.method === method);
}

function reply(method: string, result: unknown): void {
  const message = request(method);
  if (message?.id === undefined) throw new Error(`Missing ${method} request`);
  onLine?.(JSON.stringify({ id: message.id, result }));
}

function notify(method: string, params: unknown): void {
  onLine?.(JSON.stringify({ method, params }));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
});

afterEach(async () => {
  await stopCodexTextPrompt();
});

it("starts generated-text threads as ephemeral Codex sessions", async () => {
  const result = runCodexTextPrompt({ cwd: "/repo", prompt: "Generate text" });

  await waitFor(() => !!request("initialize"), "initialize");
  reply("initialize", {});
  await waitFor(() => !!request("thread/start"), "thread/start");
  expect(request("thread/start")?.params).toMatchObject({ ephemeral: true });
  reply("thread/start", { thread: { id: "text-thread" } });
  await waitFor(() => !!request("turn/start"), "turn/start");
  reply("turn/start", { turn: { id: "text-turn" } });
  notify("item/agentMessage/delta", { delta: "Generated text" });
  notify("turn/completed", {
    turn: { id: "text-turn", status: "completed" },
  });

  await expect(result).resolves.toBe("Generated text");
  expect(messages().some((message) => message.method === "thread/resume")).toBe(
    false,
  );
});
