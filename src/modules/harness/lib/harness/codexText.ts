import { modelsFor } from "../models";
import {
  closeRetiredRawChildren,
  reserveRawChild,
  resolveCodexBinary,
  type RawChildHandle,
} from "./child";
import {
  asRecord,
  buildThreadStartParams,
  buildTurnStartParams,
  stringField,
} from "./codexProtocol";
import { JsonRpcClient, type JsonRpcId } from "./jsonRpc";
import { mergeStream, streamTextDelta } from "./streamText";

const TEXT_CHILD_ID = "monocode-codex-text";
const INIT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
const TEXT_RUNTIME_MODE = "supervised" as const;
const TEXT_MODEL = "gpt-6-luna";
const TEXT_EFFORT = "low";

type LiveText = {
  handle: RawChildHandle;
  epoch: number;
  opening?: Promise<LiveText>;
  rpc: JsonRpcClient;
  cwd: string;
  providerAccountId?: string;
  threadId: string;
  model: string;
  effort: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
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
  if (expected !== epoch) throw new Error("Codex text generation was retired");
}

function assertCurrent(session: LiveText): void {
  if (!isCurrent(session)) throw new Error("Codex text generation was retired");
}

function pickTextModel(): string {
  const models = modelsFor("codex");
  const luna = models.find((model) =>
    /6-luna/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return luna?.nativeId ?? TEXT_MODEL;
}

function pickTextEffort(modelId: string): string {
  const model = modelsFor("codex").find((entry) => entry.nativeId === modelId);
  const setting = model?.settings?.find(
    (entry) => entry.id === "reasoningEffort",
  );
  const options = setting?.options?.map((option) => option.value) ?? [];
  if (options.includes("low")) return "low";
  if (options.includes("none")) return "none";
  if (setting?.value && options.includes(setting.value)) return setting.value;
  return TEXT_EFFORT;
}

export async function stopCodexTextPrompt(): Promise<void> {
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

/** Start the shared Codex app-server in the background so the first prompt is fast. */
export function warmupCodexText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const expected = epoch;
  const run = turns
    .catch(() => undefined)
    .then(async () => {
      assertEpoch(expected);
      await ensureLive(cwd, undefined, undefined, expected);
    });
  turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch(() => undefined);
}

/** Codex app-server turn that reuses a warm process, like Cursor text generation. */
export async function runCodexTextPrompt(input: {
  cwd: string;
  providerAccountId?: string;
  prompt: string;
  timeoutMs?: number;
  /** Native model id. Defaults to the cheap one used for titles and commits. */
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const captured = { ...input };
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
          session.turnFailed?.(new Error("Codex text generation cancelled"));
          reject(new Error("Codex text generation cancelled"));
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

    await session.rpc.request(
      "turn/start",
      buildTurnStartParams({
        threadId: session.threadId,
        runtimeMode: TEXT_RUNTIME_MODE,
        prompt: input.prompt,
        model: session.model || undefined,
        effort: session.effort,
      }),
      timeoutMs,
    );
    assertCurrent(session);

    await Promise.race([
      turnPromise,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Codex text generation timed out")),
          timeoutMs,
        );
      }),
      ...(abortPromise ? [abortPromise] : []),
    ]);

    assertCurrent(session);
    return session.output;
  } catch (error) {
    if (isCurrent(session)) {
      await session.rpc
        .request("turn/interrupt", { threadId: session.threadId })
        .catch(() => undefined);
    }
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
  requestedModel: string | undefined,
  expected: number,
): Promise<LiveText> {
  assertEpoch(expected);
  const model = requestedModel ?? pickTextModel();
  const effort = pickTextEffort(model);
  const current = live;
  if (current && isCurrent(current)) {
    if (
      current.cwd === cwd &&
      current.model === model &&
      current.effort === effort &&
      current.providerAccountId === providerAccountId
    ) {
      return current;
    }
    if (current.providerAccountId === providerAccountId) {
      try {
        current.model = model;
        current.effort = effort;
        await openThread(current, cwd);
        assertCurrent(current);
        return current;
      } catch (error) {
        if (!isCurrent(current)) throw error;
      }
    }
  }
  const pending = opening;
  if (
    pending &&
    isCurrent(pending) &&
    pending.cwd === cwd &&
    pending.model === model &&
    pending.providerAccountId === providerAccountId &&
    pending.opening
  ) {
    return pending.opening;
  }
  return startLive(cwd, providerAccountId, model, expected);
}

function startLive(
  cwd: string,
  providerAccountId: string | undefined,
  model: string,
  expected: number,
): Promise<LiveText> {
  assertEpoch(expected);
  const handle = reserveRawChild(TEXT_CHILD_ID);
  if (handle.retired) throw new Error("Codex text generation was retired");
  const previous = live;
  const previousOpening = opening;
  const sessionRef: { session: LiveText | null } = { session: null };
  const rpc = new JsonRpcClient(
    handle.nativeId,
    {
      onNotification: (method, params) => {
        const session = sessionRef.session;
        if (session && isCurrent(session))
          handleNotification(session, method, params);
      },
      onRequest: (id, method, params) => {
        const session = sessionRef.session;
        if (session && isCurrent(session))
          void handleServerRequest(rpc, id, method, params);
      },
    },
    { includeJsonrpc: false, label: "codex-text", write: handle.write },
  );
  const session: LiveText = {
    handle,
    epoch: expected,
    rpc,
    cwd,
    providerAccountId,
    threadId: "",
    model,
    effort: pickTextEffort(model),
    collecting: false,
    output: "",
    closed: false,
    turnDone: null,
    turnFailed: null,
  };
  sessionRef.session = session;
  opening = session;
  if (previous) void dropLive(previous);
  if (previousOpening && previousOpening !== previous)
    void dropLive(previousOpening);
  session.opening = initializeText(session);
  return session.opening;
}

async function initializeText(session: LiveText): Promise<LiveText> {
  const { rpc, handle, cwd, providerAccountId } = session;
  try {
    const { path } = await resolveCodexBinary();
    assertCurrent(session);
    handle.watch(
      (line) => {
        if (isCurrent(session)) rpc.pushLine(line);
      },
      () => {
        if (isCurrent(session))
          void dropLive(session, new Error("Codex text generator exited"));
      },
    );
    await handle.spawn(path, ["app-server"], cwd, null, {
      provider: "codex",
      id: providerAccountId ?? "default",
    });
    assertCurrent(session);
    await rpc.request(
      "initialize",
      {
        clientInfo: {
          name: "monocode-text",
          title: "MonoCode",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      },
      INIT_TIMEOUT_MS,
    );
    assertCurrent(session);
    await rpc.notify("initialized", undefined);
    assertCurrent(session);
    await openThread(session, cwd);
    assertCurrent(session);
    if (opening === session) opening = null;
    live = session;
    return session;
  } catch (error) {
    await dropLive(
      session,
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

async function openThread(session: LiveText, cwd: string): Promise<void> {
  assertCurrent(session);
  const opened = await session.rpc.request<{ thread?: { id?: string } }>(
    "thread/start",
    {
      ...buildThreadStartParams({
        cwd,
        runtimeMode: TEXT_RUNTIME_MODE,
        model: session.model || undefined,
      }),
      ephemeral: true,
    },
    INIT_TIMEOUT_MS,
  );
  assertCurrent(session);
  const threadId = opened.thread?.id?.trim();
  if (!threadId) throw new Error("Codex did not return a thread id");
  session.cwd = cwd;
  session.threadId = threadId;
}

function dropLive(session: LiveText, error?: Error): Promise<void> {
  if (live === session) live = null;
  if (opening === session) opening = null;
  if (!session.closed) {
    session.closed = true;
    session.turnFailed?.(error ?? new Error("Codex text generation cancelled"));
    session.turnDone = null;
    session.turnFailed = null;
    session.rpc.close(error);
  }
  return session.handle.close().catch(() => undefined);
}

function handleNotification(
  session: LiveText | null,
  method: string,
  params: unknown,
): void {
  if (!session || !session.collecting) {
    if (session && method === "turn/completed") {
      session.turnDone?.();
      session.turnDone = null;
      session.turnFailed = null;
    }
    return;
  }

  if (method === "item/agentMessage/delta") {
    const delta = streamTextDelta(asRecord(params)?.delta);
    if (delta) session.output = mergeStream(session.output, delta);
    return;
  }

  if (method === "turn/completed") {
    const turn = asRecord(asRecord(params)?.turn);
    const status = stringField(turn, "status") ?? "completed";
    if (status === "failed") {
      const message =
        stringField(asRecord(turn?.error), "message") ?? "Codex turn failed";
      session.turnFailed?.(new Error(message));
    } else {
      session.turnDone?.();
    }
    session.turnDone = null;
    session.turnFailed = null;
  }
}

async function handleServerRequest(
  rpc: JsonRpcClient,
  id: JsonRpcId,
  method: string,
  _params: unknown,
): Promise<void> {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    await rpc.respond(id, { decision: "decline" }).catch(() => undefined);
    return;
  }
  if (method === "item/permissions/requestApproval") {
    await rpc.respond(id, { permissions: {} }).catch(() => undefined);
    return;
  }
  await rpc.respond(id, {}).catch(() => undefined);
}
