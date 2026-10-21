import { modelsFor } from "../models";
import {
  closeRetiredRawChildren,
  type RawChildHandle,
  reserveRawChild,
} from "./child";
import { PiRpc } from "./piClient";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import {
  agentEndWillRetry,
  asRecord,
  assistantDeltaFromEvent,
  buildPiPrompt,
  buildPiSpawnArgs,
  isAgentSettled,
} from "./piProtocol";
import { mergeStream } from "./streamText";

const INIT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 45_000;
type TextInput = { cwd: string; prompt: string; timeoutMs?: number };
type LiveText = {
  handle: RawChildHandle;
  rpc: PiRpc;
  state: TextState;
  flavor: PiFlavor;
  epoch: number;
  opening?: Promise<LiveText>;
  cwd: string;
  args: string[];
  collecting: boolean;
  output: string;
  closed: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
};
type TextState = {
  live: LiveText | null;
  opening: LiveText | null;
  epoch: number;
  turns: Promise<void>;
};
const stateByFlavor = new Map<string, TextState>();
function stateFor(flavor: PiFlavor): TextState {
  let state = stateByFlavor.get(flavor.id);
  if (!state) {
    state = { live: null, opening: null, epoch: 0, turns: Promise.resolve() };
    stateByFlavor.set(flavor.id, state);
  }
  return state;
}
function captureFlavor(flavor: PiFlavor): PiFlavor {
  return {
    ...flavor,
    isolateFlags: flavor.isolateFlags.slice(),
    planTools: flavor.planTools.slice(),
  };
}
function isCurrent(session: LiveText): boolean {
  return (
    session.epoch === session.state.epoch &&
    !session.closed &&
    !session.handle.retired &&
    (session.state.live === session || session.state.opening === session)
  );
}
function assertEpoch(state: TextState, expected: number): void {
  if (state.epoch !== expected)
    throw new Error("Pi text generation was retired");
}
function assertCurrent(session: LiveText): void {
  if (!isCurrent(session))
    throw new Error(`${session.flavor.label} text generation was retired`);
}
function pickTextModel(flavor: PiFlavor): string | undefined {
  const models = modelsFor(flavor.id).filter((model) =>
    Boolean(model.nativeId?.includes("/")),
  );
  const cheap = models.find((model) =>
    /haiku|mini|flash|nano|lite|luna/i.test(
      `${model.nativeId ?? ""} ${model.name} ${model.id}`,
    ),
  );
  return (cheap ?? models[0])?.nativeId?.trim() || undefined;
}
export async function stopTextPrompt(flavor: PiFlavor): Promise<void> {
  const state = stateFor(flavor);
  const current = state.live;
  const pending = state.opening;
  const logicalId =
    pending?.handle.logicalSessionId ??
    current?.handle.logicalSessionId ??
    flavor.textChildId;
  state.epoch += 1;
  state.turns = Promise.resolve();
  state.live = null;
  state.opening = null;
  const retired = closeRetiredRawChildren(logicalId).catch(() => undefined);
  const closing = current ? dropLive(current) : Promise.resolve();
  const starting =
    pending && pending !== current ? dropLive(pending) : Promise.resolve();
  await Promise.all([retired, closing, starting]);
}
export function warmupText(flavor: PiFlavor, cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const captured = captureFlavor(flavor);
  const state = stateFor(captured);
  const expected = state.epoch;
  const args = buildPiSpawnArgs(captured, {
    isolated: true,
    model: pickTextModel(captured),
  });
  const run = state.turns
    .catch(() => undefined)
    .then(async () => {
      assertEpoch(state, expected);
      await ensureLive(state, captured, cwd, args, expected);
    });
  state.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch(() => undefined);
}
export async function runTextPrompt(
  flavor: PiFlavor,
  input: TextInput,
): Promise<string> {
  const captured = captureFlavor(flavor);
  const capturedInput = { ...input };
  const state = stateFor(captured);
  const expected = state.epoch;
  const args = buildPiSpawnArgs(captured, {
    isolated: true,
    model: pickTextModel(captured),
  });
  const run = state.turns
    .catch(() => undefined)
    .then(() => {
      assertEpoch(state, expected);
      return promptOnLive(state, captured, capturedInput, args, expected);
    });
  state.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
async function promptOnLive(
  state: TextState,
  flavor: PiFlavor,
  input: TextInput,
  args: string[],
  expected: number,
): Promise<string> {
  const session = await ensureLive(state, flavor, input.cwd, args, expected);
  assertCurrent(session);
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await session.rpc.request({ type: "new_session" }).catch(() => undefined);
    assertCurrent(session);
    await session.rpc
      .request({ type: "set_thinking_level", level: "off" })
      .catch(() => undefined);
    assertCurrent(session);
    session.output = "";
    session.collecting = true;
    session.turnEndPending = false;
    const turnPromise = new Promise<void>((resolve, reject) => {
      session.turnDone = resolve;
      session.turnFailed = reject;
    });
    void turnPromise.catch(() => undefined);
    await session.rpc.request(buildPiPrompt({ text: input.prompt }), timeoutMs);
    assertCurrent(session);
    if (session.turnEndPending) finishTurn(session);
    await Promise.race([
      turnPromise,
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${flavor.label} text generation timed out`)),
          timeoutMs,
        );
      }),
    ]);
    assertCurrent(session);
    let output = session.output.trim();
    if (!output) {
      const rec = await session.rpc
        .request({ type: "get_last_assistant_text" })
        .catch(() => null);
      assertCurrent(session);
      const text = asRecord(rec?.data)?.text;
      if (typeof text === "string") output = text.trim();
    }
    if (!output) throw new Error(`${flavor.label} returned empty output.`);
    return output;
  } catch (error) {
    session.turnDone = null;
    session.turnFailed = null;
    if (isCurrent(session)) {
      await session.rpc.request({ type: "abort" }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    session.collecting = false;
    session.turnDone = null;
    session.turnFailed = null;
    await dropLive(session);
  }
}
async function ensureLive(
  state: TextState,
  flavor: PiFlavor,
  cwd: string,
  args: string[],
  expected: number,
): Promise<LiveText> {
  assertEpoch(state, expected);
  const matches = (session: LiveText) =>
    isCurrent(session) &&
    session.cwd === cwd &&
    session.flavor.resolveBinary === flavor.resolveBinary &&
    session.handle.logicalSessionId === flavor.textChildId &&
    session.args.length === args.length &&
    session.args.every((arg, index) => arg === args[index]);
  if (state.live && matches(state.live)) return state.live;
  if (state.opening && matches(state.opening) && state.opening.opening)
    return state.opening.opening;
  return startLive(state, flavor, cwd, args, expected);
}
function startLive(
  state: TextState,
  flavor: PiFlavor,
  cwd: string,
  args: string[],
  expected: number,
): Promise<LiveText> {
  assertEpoch(state, expected);
  const handle = reserveRawChild(flavor.textChildId);
  if (state.epoch !== expected || handle.retired) {
    void handle.close().catch(() => undefined);
    throw new Error(`${flavor.label} text generation was retired`);
  }
  const previous = state.live;
  const previousOpening = state.opening;
  let session: LiveText;
  const rpc = new PiRpc(
    handle.nativeId,
    (rec) => {
      if (isCurrent(session)) handleFrame(session, rec);
    },
    flavor.label,
    handle.write,
  );
  session = {
    handle,
    rpc,
    state,
    flavor,
    epoch: expected,
    cwd,
    args,
    collecting: false,
    output: "",
    closed: false,
    turnDone: null,
    turnFailed: null,
    turnEndPending: false,
  };
  state.opening = session;
  state.live = null;
  if (previous) void dropLive(previous);
  if (previousOpening && previousOpening !== previous)
    void dropLive(previousOpening);
  session.opening = initializeText(session);
  void session.opening.catch(() => undefined);
  return session.opening;
}
async function initializeText(session: LiveText): Promise<LiveText> {
  try {
    assertCurrent(session);
    const { path } = await session.flavor.resolveBinary();
    assertCurrent(session);
    session.handle.watch(
      (line) => {
        if (isCurrent(session)) session.rpc.pushLine(line);
      },
      () => {
        if (isCurrent(session))
          void dropLive(
            session,
            new Error(`${session.flavor.label} text generator exited`),
          );
      },
    );
    assertCurrent(session);
    await session.handle.spawn(path, session.args, session.cwd);
    assertCurrent(session);
    await session.rpc.request({ type: "get_state" }, INIT_TIMEOUT_MS);
    assertCurrent(session);
    session.state.opening = null;
    session.state.live = session;
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
  if (session.state.live === session) session.state.live = null;
  if (session.state.opening === session) session.state.opening = null;
  if (!session.closed) {
    session.closed = true;
    const stopped =
      error ?? new Error(`${session.flavor.label} text generator stopped`);
    session.rpc.close(stopped);
    session.turnFailed?.(stopped);
    session.turnDone = null;
    session.turnFailed = null;
    session.output = "";
  }
  return session.handle.close().catch(() => undefined);
}
function handleFrame(session: LiveText, rec: Record<string, unknown>) {
  if (!session.collecting) return;
  const delta = assistantDeltaFromEvent(rec);
  if (delta?.kind === "text")
    session.output = mergeStream(session.output, delta.text);
  if (isAgentSettled(rec) || agentEndWillRetry(rec) === false) {
    if (session.turnDone) finishTurn(session);
    else session.turnEndPending = true;
  }
}
function finishTurn(session: LiveText) {
  session.turnEndPending = false;
  const done = session.turnDone;
  session.turnDone = null;
  session.turnFailed = null;
  done?.();
}
export const stopPiTextPrompt = () => stopTextPrompt(PI_FLAVOR);
export const warmupPiText = (cwd: string) => warmupText(PI_FLAVOR, cwd);
export const runPiTextPrompt = (input: TextInput) =>
  runTextPrompt(PI_FLAVOR, input);
export const stopOmpTextPrompt = () => stopTextPrompt(OMP_FLAVOR);
export const warmupOmpText = (cwd: string) => warmupText(OMP_FLAVOR, cwd);
export const runOmpTextPrompt = (input: TextInput) =>
  runTextPrompt(OMP_FLAVOR, input);
