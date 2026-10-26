// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { transcribeAudio } from "@/modules/ai/lib/stt";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";

afterEach(() => vi.unstubAllGlobals());

it("does not send an already-aborted transcription", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const abort = new AbortController();
  abort.abort();
  await expect(
    transcribeAudio(
      new Blob(["audio"]),
      "groq",
      { ...EMPTY_PROVIDER_KEYS, groq: "fixture" },
      { abortSignal: abort.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["request", "body"])(
  "propagates cancellation during REST %s and retains the original timeout",
  async (phase) => {
    const abort = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      requestSignal = options.signal ?? undefined;
      const failed = new Promise<never>((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("fixture", "AbortError")),
          { once: true },
        );
      });
      if (phase === "request") return failed;
      return { ok: true, text: () => failed };
    });
    vi.stubGlobal("fetch", fetch);
    const pending = transcribeAudio(
      new Blob(["audio"]),
      "groq",
      { ...EMPTY_PROVIDER_KEYS, groq: "fixture" },
      { abortSignal: abort.signal },
    );
    const observed = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    abort.abort();
    await observed;
    expect(requestSignal?.aborted).toBe(true);
  },
);

it("keeps Whisper.cpp loopback validation before audio decoding or fetch", async () => {
  const fetch = vi.fn();
  const audio = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("AudioContext", audio);
  await expect(
    transcribeAudio(
      new Blob(),
      "whispercpp",
      { ...EMPTY_PROVIDER_KEYS },
      { whispercppBaseURL: "https://example.invalid" },
    ),
  ).rejects.toThrow("loopback");
  expect(audio).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("aborts browser recognition and ignores late events", async () => {
  const abort = new AbortController();
  const stop = vi.fn();
  const cancel = vi.fn();
  const events: { end?: () => void } = {};
  class Speech {
    onend: (() => void) | null = null;
    onresult = null;
    onerror = null;
    start() {
      events.end = this.onend ?? undefined;
    }
    stop = stop;
    abort = cancel;
  }
  vi.stubGlobal("SpeechRecognition", Speech);
  const listening = vi.fn();
  const pending = transcribeAudio(
    new Blob(),
    "browser",
    { ...EMPTY_PROVIDER_KEYS },
    { abortSignal: abort.signal, onListening: listening },
  );
  const observed = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  abort.abort();
  events.end?.();
  await observed;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
  expect(listening).toHaveBeenCalledTimes(1);
});

it("finishes browser recognition separately from abort", async () => {
  const stop = vi.fn();
  const cancel = vi.fn();
  let finish: (() => void) | undefined;
  class Speech {
    onend: (() => void) | null = null;
    onresult = null;
    onerror = null;
    start() {}
    stop() {
      stop();
      this.onend?.();
    }
    abort = cancel;
  }
  vi.stubGlobal("SpeechRecognition", Speech);
  const pending = transcribeAudio(
    new Blob(),
    "browser",
    { ...EMPTY_PROVIDER_KEYS },
    {
      onListening: (value) => {
        finish = value;
      },
    },
  );
  finish?.();
  finish?.();
  expect(await pending).toBe("");
  expect(stop).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
});
