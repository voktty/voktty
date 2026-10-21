import { modelsFor } from "../models";
import {
  closeRetiredRawChildren,
  type RawChildHandle,
  reserveRawChild,
  resolveClaudeBinary,
} from "./child";
import {
  assistantTextBlocks,
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  parseJsonLine,
  stringField,
  turnStatusFromResult,
} from "./claudeProtocol";
import { mergeStream } from "./streamText";

const TEXT_CHILD_ID = "monocode-claude-text";
const INIT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 45_000;
const TEXT_MODEL = "claude-haiku-5-5";

type LiveText = {
  handle: RawChildHandle;
  epoch: number;
  opening?: Promise<LiveText>;
  cwd: string;
  providerAccountId?: string;
  model: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  ready: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  readyDone: (() => void) | null;
};

let live: LiveText | null = null;
let opening: LiveText | null = null;
let epoch = 0;
let turns: Promise<void> = Promise.resolve();

function isCurrent(session: LiveText): boolean {
  return (
    session.epoch === epoch &&
    !session.closed &&
    !session.handle.retired &&
    (live === session || opening === session)
  );
}

function assertEpoch(expected: number): void {
  if (expected !== epoch) throw new Error("Claude text generation was retired");
}

function assertCurrent(session: LiveText): void {
  if (!isCurrent(session))
    throw new Error("Claude text generation was retired");
}

function pickTextModel(): string {
  const models = modelsFor("claude");
  const haiku = models.find((model) =>
    /haiku/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return haiku?.nativeId ?? TEXT_MODEL;
}

export async function stopClaudeTextPrompt(): Promise<void> {
  const current = live;
  const pending = opening;
  epoch += 1;
  turns = Promise.resolve();
  const closing = current ? dropLive(current) : Promise.resolve();
  const starting =
    pending && pending !== current ? dropLive(pending) : Promise.resolve();
  const retired = closeRetiredRawChildren(TEXT_CHILD_ID).catch(() => undefined);
  await Promise.all([closing, starting, retired]);
}

export function warmupClaudeText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const expected = epoch;
  const model = pickTextModel();
  const run = turns
    .catch(() => undefined)
    .then(async () => {
      assertEpoch(expected);
      await ensureLive(cwd, undefined, model, expected);
    });
  turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch(() => undefined);
}

export async function runClaudeTextPrompt(input: {
  cwd: string;
  providerAccountId?: string;
  prompt: string;
  timeoutMs?: number;
  /** Native model id. Defaults to the cheap one used for titles and commits. */
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const captured = { ...input, model: input.model ?? pickTextModel() };
  const expected = epoch;
  const run = turns
    .catch(() => undefined)
    .then(() => {
      assertEpoch(expected);
      return promptOnLive(captured, expected);
    });
  turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function promptOnLive(
  input: {
    cwd: string;
    providerAccountId?: string;
    prompt: string;
    timeoutMs?: number;
    model?: string;
    signal?: AbortSignal;
  },
  expected: number,
): Promise<string> {
  input.signal?.throwIfAborted();
  const session = await ensureLive(
    input.cwd,
    input.providerAccountId,
    input.model,
    expected,
  );
  assertCurrent(session);
  input.signal?.throwIfAborted();
  session.output = "";
  session.collecting = true;
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let abortHandler: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abortPromise = input.signal
    ? new Promise<never>((_, reject) => {
        const cancel = () => {
          session.turnFailed?.(new Error("Claude text generation cancelled"));
          reject(new Error("Claude text generation cancelled"));
        };
        abortHandler = cancel;
        input.signal!.addEventListener("abort", cancel, { once: true });
        if (input.signal!.aborted) cancel();
      })
    : null;
  void abortPromise?.catch(() => undefined);

  try {
    const turnPromise = new Promise<void>((resolve, reject) => {
      session.turnDone = resolve;
      session.turnFailed = reject;
    });
    void turnPromise.catch(() => undefined);

    await session.handle.write(
      JSON.stringify(buildClaudeUserMessage({ text: input.prompt })),
    );
    assertCurrent(session);

    await Promise.race([
      turnPromise,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Claude text generation timed out")),
          timeoutMs,
        );
      }),
      ...(abortPromise ? [abortPromise] : []),
    ]);

    assertCurrent(session);
    const output = session.output.trim();
    if (!output) throw new Error("Claude returned empty output.");
    return output;
  } catch (error) {
    if (session.closed) await dropLive(session);
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortHandler && input.signal) {
      input.signal.removeEventListener("abort", abortHandler);
    }
    session.collecting = false;
    session.turnDone = null;
    session.turnFailed = null;
    await dropLive(session);
  }
}

async function ensureLive(
  cwd: string,
  providerAccountId: string | undefined,
  model: string | undefined,
  expected: number,
): Promise<LiveText> {
  assertEpoch(expected);
  const wanted = model ?? pickTextModel();
  const current = live;
  if (
    current &&
    isCurrent(current) &&
    current.cwd === cwd &&
    current.providerAccountId === providerAccountId &&
    current.model === wanted
  ) {
    return current;
  }
  const pending = opening;
  if (
    pending &&
    isCurrent(pending) &&
    pending.cwd === cwd &&
    pending.providerAccountId === providerAccountId &&
    pending.model === wanted &&
    pending.opening
  ) {
    return pending.opening;
  }
  return startLive(cwd, providerAccountId, wanted, expected);
}

function startLive(
  cwd: string,
  providerAccountId: string | undefined,
  model: string,
  expected: number,
): Promise<LiveText> {
  assertEpoch(expected);
  const handle = reserveRawChild(TEXT_CHILD_ID);
  if (expected !== epoch || handle.retired) {
    void handle.close().catch(() => undefined);
    throw new Error("Claude text generation was retired");
  }
  const previous = live;
  const previousOpening = opening;
  const session: LiveText = {
    handle,
    epoch: expected,
    cwd,
    providerAccountId,
    model,
    collecting: false,
    output: "",
    closed: false,
    ready: false,
    turnDone: null,
    turnFailed: null,
    readyDone: null,
  };
  opening = session;
  if (previous) void dropLive(previous);
  if (previousOpening && previousOpening !== previous)
    void dropLive(previousOpening);
  session.opening = initializeText(session);
  void session.opening.catch(() => undefined);
  return session.opening;
}

async function initializeText(session: LiveText): Promise<LiveText> {
  const { handle, cwd, providerAccountId, model } = session;
  try {
    const { path } = await resolveClaudeBinary();
    assertCurrent(session);
    handle.watch(
      (line) => {
        if (isCurrent(session)) handleLine(session, line);
      },
      () => {
        if (isCurrent(session))
          void dropLive(session, new Error("Claude text generator exited"));
      },
    );
    await handle.spawn(
      path,
      buildClaudeSpawnArgs({ isolated: true, model }),
      cwd,
      null,
      { provider: "claude", id: providerAccountId ?? "default" },
    );
    assertCurrent(session);
    await waitForReady(session, INIT_TIMEOUT_MS);
    assertCurrent(session);
    if (opening === session) opening = null;
    live = session;
    session.opening = undefined;
    return session;
  } catch (error) {
    await dropLive(
      session,
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

function dropLive(session: LiveText, error?: Error): Promise<void> {
  if (live === session) live = null;
  if (opening === session) opening = null;
  if (!session.closed) {
    session.closed = true;
    session.readyDone?.();
    session.turnFailed?.(error ?? new Error("Claude text generator stopped"));
    session.turnDone = null;
    session.turnFailed = null;
    session.readyDone = null;
    session.output = "";
  }
  return session.handle.close().catch(() => undefined);
}

function handleLine(session: LiveText, line: string): void {
  const rec = parseJsonLine(line);
  if (!rec) return;
  const type = stringField(rec, "type");
  if (
    type === "system" &&
    (stringField(rec, "subtype") === "init" ||
      stringField(rec, "subtype") === "initialized")
  ) {
    session.ready = true;
    session.readyDone?.();
    session.readyDone = null;
  }
  if (!session.collecting) return;
  if (type === "assistant") {
    const snapshot = assistantTextBlocks(rec).join("");
    if (snapshot) session.output = mergeStream(session.output, snapshot);
    return;
  }
  if (type === "stream_event") {
    const event = rec.event;
    if (!event || typeof event !== "object") return;
    const delta = (event as { delta?: { type?: string; text?: string } }).delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      session.output = mergeStream(session.output, delta.text);
    }
    return;
  }
  if (type === "result") {
    const result = turnStatusFromResult(rec);
    if (result.status === "failed") {
      session.turnFailed?.(new Error(result.error ?? "Claude turn failed"));
    } else {
      session.turnDone?.();
    }
    session.turnDone = null;
    session.turnFailed = null;
  }
}

function waitForReady(session: LiveText, timeoutMs: number): Promise<void> {
  if (session.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.readyDone = null;
      resolve();
    }, timeoutMs);
    session.readyDone = () => {
      clearTimeout(timer);
      if (session.closed) {
        reject(new Error("Claude text generator exited"));
        return;
      }
      resolve();
    };
  });
}
