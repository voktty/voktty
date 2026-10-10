import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
let onExit: ((code: number | null) => void) | undefined;
const mocks = vi.hoisted(() => ({
  execChild: vi.fn(async () => ""),
  killChild: vi.fn(async () => undefined),
}));

vi.mock("./child", () => ({
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  execChild: mocks.execChild,
  spawnChild: async () => undefined,
  killChild: mocks.killChild,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (value: string) => void,
    exit: (code: number | null) => void,
  ) => {
    onLine = line;
    onExit = exit;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const { runGrokTextPrompt, stopGrokTextPrompt, warmupGrokText } = await import(
  "./grokText"
);

const SESSION_A = "550e8400-e29b-41d4-a716-446655440000";
const SESSION_B = "550e8400-e29b-41d4-a716-446655440001";

function messages(): Array<Record<string, unknown>> {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function outbound(method: string): Record<string, unknown> | undefined {
  return messages().find((message) => message.method === method);
}

function reply(method: string, result: unknown): void {
  const request = outbound(method);
  if (typeof request?.id !== "number")
    throw new Error(`Missing ${method} request`);
  onLine?.(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openTextSession(sessionId = SESSION_A): Promise<void> {
  await waitFor(() => !!outbound("initialize"), "initialize");
  reply("initialize", {});
  await waitFor(() => !!outbound("session/new"), "session/new");
  reply("session/new", { sessionId });
  await waitFor(() => !!outbound("session/set_model"), "session/set_model");
  reply("session/set_model", {});
  await waitFor(() => !!outbound("session/set_mode"), "session/set_mode");
  reply("session/set_mode", {});
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
  onExit = undefined;
  mocks.execChild.mockReset();
  mocks.execChild.mockResolvedValue("");
  mocks.killChild.mockClear();
});

afterEach(async () => {
  await stopGrokTextPrompt();
});

it("deletes the temporary ACP session after generated text completes", async () => {
  const result = runGrokTextPrompt({
    cwd: "/repo",
    prompt: "Generate text",
    timeoutMs: 1000,
  });
  await openTextSession();
  await waitFor(() => !!outbound("session/prompt"), "session/prompt");
  onLine?.(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_A,
        update: { sessionUpdate: "agent_message", content: "Generated text" },
      },
    }),
  );
  reply("session/prompt", {});

  await expect(result).resolves.toBe("Generated text");
  expect(mocks.execChild).toHaveBeenCalledWith(
    "/fake/grok",
    ["--no-auto-update", "sessions", "delete", SESSION_A],
    "/repo",
    "grok",
  );
  expect(mocks.killChild.mock.invocationCallOrder.slice(-1)[0]).toBeLessThan(
    mocks.execChild.mock.invocationCallOrder[0],
  );
});

it("deletes the temporary session when generation fails", async () => {
  const result = runGrokTextPrompt({
    cwd: "/repo",
    prompt: "Generate text",
    timeoutMs: 1000,
  });
  const rejected = expect(result).rejects.toThrow("Generation failed");
  await openTextSession();
  await waitFor(() => !!outbound("session/prompt"), "session/prompt");
  const request = outbound("session/prompt");
  onLine?.(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request?.id,
      error: { message: "Generation failed" },
    }),
  );

  await rejected;
  expect(mocks.execChild).toHaveBeenCalledWith(
    "/fake/grok",
    ["--no-auto-update", "sessions", "delete", SESSION_A],
    "/repo",
    "grok",
  );
});

it("cancels generation and deletes its temporary session", async () => {
  const controller = new AbortController();
  const result = runGrokTextPrompt({
    cwd: "/repo",
    prompt: "Generate text",
    timeoutMs: 1000,
    signal: controller.signal,
  });
  await openTextSession();
  await waitFor(() => !!outbound("session/prompt"), "session/prompt");
  controller.abort();

  await expect(result).rejects.toThrow("By-the-way request cancelled");
  expect(outbound("session/cancel")).toBeDefined();
  expect(mocks.execChild).toHaveBeenCalledWith(
    "/fake/grok",
    ["--no-auto-update", "sessions", "delete", SESSION_A],
    "/repo",
    "grok",
  );
});

it("deletes a warm session before switching working directories", async () => {
  const warmup = warmupGrokText("/repo");
  await openTextSession(SESSION_A);
  await warmup;
  sent.length = 0;

  const result = runGrokTextPrompt({
    cwd: "/repo/other",
    prompt: "Generate text",
    timeoutMs: 1000,
  });
  await openTextSession(SESSION_B);
  expect(mocks.execChild).toHaveBeenCalledWith(
    "/fake/grok",
    ["--no-auto-update", "sessions", "delete", SESSION_A],
    "/repo",
    "grok",
  );
  await waitFor(() => !!outbound("session/prompt"), "session/prompt");
  reply("session/prompt", {});
  await result;
  expect(mocks.execChild).toHaveBeenCalledTimes(2);
});

it("cleans up the saved session after its provider exits", async () => {
  const warmup = warmupGrokText("/repo");
  await openTextSession();
  await warmup;
  onExit?.(0);
  await stopGrokTextPrompt();

  expect(mocks.execChild).toHaveBeenCalledWith(
    "/fake/grok",
    ["--no-auto-update", "sessions", "delete", SESSION_A],
    "/repo",
    "grok",
  );
});

it("does not pass a non-UUID provider value to the cleanup command", async () => {
  const warmup = warmupGrokText("/repo");
  await openTextSession("--all");
  await warmup;
  await stopGrokTextPrompt();

  expect(mocks.execChild).not.toHaveBeenCalled();
});
