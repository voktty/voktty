import { afterEach, expect, it, vi } from "vitest";
import { createVoiceRecording } from "@/modules/ai/lib/ownedVoiceRecording";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";

const transcribe = vi.hoisted(() => vi.fn());
vi.mock("@/modules/ai/lib/stt", () => ({ transcribeAudio: transcribe }));
afterEach(() => {
  transcribe.mockReset();
  vi.useRealTimers();
});
function deferred() {
  let finish: (text: string) => void = () => {};
  const promise = new Promise<string>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
function input() {
  return {
    provider: "browser" as const,
    keys: { ...EMPTY_PROVIDER_KEYS },
    options: {},
    isCurrent: () => true,
    onResult: vi.fn(),
  };
}

it("keeps all sixteen retired requests charged until their promises settle", async () => {
  const pending = Array.from({ length: 17 }, deferred);
  let index = 0;
  transcribe.mockImplementation(() => pending[index++].promise);
  const runs = Array.from({ length: 16 }, () =>
    createVoiceRecording(vi.fn(), vi.fn()),
  );
  const jobs = runs.map((run) => run.start(input()));
  for (const run of runs) run.retire();
  const successor = createVoiceRecording(vi.fn(), vi.fn());
  const next = input();
  let job: Promise<void> | undefined;
  try {
    await successor.start(next);
    expect(transcribe).toHaveBeenCalledTimes(16);
    pending[0].finish("retired");
    await jobs[0];
    job = successor.start(next);
    expect(transcribe).toHaveBeenCalledTimes(17);
    pending[16].finish("fresh");
    await job;
    expect(next.onResult).toHaveBeenCalledExactlyOnceWith("fresh");
  } finally {
    for (const entry of pending) entry.finish("");
    await Promise.all(jobs);
    await job;
    successor.retire();
  }
});

it("coalesces starts and preserves its captured configuration and result callback", async () => {
  const pending = deferred();
  transcribe.mockReturnValue(pending.promise);
  const run = createVoiceRecording(vi.fn(), vi.fn());
  const source = input();
  const original = source.onResult;
  const first = run.start(source);
  source.keys.openai = "replacement";
  source.onResult = vi.fn();
  await run.start(source);
  expect(transcribe).toHaveBeenCalledTimes(1);
  expect(transcribe.mock.calls[0][2].openai).toBeNull();
  pending.finish(" original ");
  await first;
  expect(original).toHaveBeenCalledExactlyOnceWith("original");
  expect(source.onResult).not.toHaveBeenCalled();
  run.retire();
});

it("cancels transcription without delivering a late result or error", async () => {
  const pending = deferred();
  transcribe.mockReturnValue(pending.promise);
  const error = vi.fn();
  const state = vi.fn();
  const run = createVoiceRecording(state, error);
  const source = input();
  const job = run.start(source);
  const signal: AbortSignal = transcribe.mock.calls[0][3].abortSignal;
  run.stop();
  expect(signal.aborted).toBe(true);
  pending.finish("late");
  await job;
  expect(source.onResult).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith("idle");
  run.retire();
});

it("finishes browser capture at its deadline and clears its timer on settlement", async () => {
  vi.useFakeTimers();
  const pending = deferred();
  const finish = vi.fn();
  transcribe.mockImplementation((_blob, _provider, _keys, options) => {
    options.onListening(finish);
    return pending.promise;
  });
  const run = createVoiceRecording(vi.fn(), vi.fn());
  const job = run.start(input());
  await vi.advanceTimersByTimeAsync(120_000);
  expect(finish).toHaveBeenCalledTimes(1);
  pending.finish("done");
  await job;
  expect(vi.getTimerCount()).toBe(0);
  run.retire();
});
