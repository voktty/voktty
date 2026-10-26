import type { SttProvider } from "@/modules/ai/config";
import type { ProviderKeys } from "@/modules/ai/lib/keyring";
import { transcribeAudio, type SttOptions } from "@/modules/ai/lib/stt";

export type VoiceState = "idle" | "recording" | "transcribing";
export type VoiceFailure = "microphone" | "browser" | "transcription";
const MAX_PENDING = 16;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_CAPTURE_MS = 120_000;
let pending = 0;

type Input = {
  provider: SttProvider;
  keys: ProviderKeys;
  options: SttOptions;
  isCurrent: () => boolean;
  onResult: (text: string) => void;
};
type Capture = Input & {
  abort: AbortController;
  stream?: MediaStream;
  finish?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};
function abortError() {
  return new DOMException("Voice recording retired.", "AbortError");
}
function stopTracks(capture: Capture) {
  const stream = capture.stream;
  capture.stream = undefined;
  for (const track of stream?.getTracks() ?? []) track.stop();
}
function clearTimer(capture: Capture) {
  if (capture.timer !== undefined) clearTimeout(capture.timer);
  capture.timer = undefined;
}

async function record(capture: Capture, stream: MediaStream): Promise<Blob> {
  const mime = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ].find((value) => MediaRecorder.isTypeSupported(value));
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : undefined,
  );
  const chunks: Blob[] = [];
  let bytes = 0;
  let stopping = false;
  let failure: Error | undefined;
  const finish = () => {
    if (stopping || recorder.state === "inactive") return;
    stopping = true;
    try {
      recorder.stop();
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new Error("Voice recording could not stop.");
      stopTracks(capture);
    }
  };
  const abort = () => {
    finish();
    stopTracks(capture);
  };
  capture.finish = finish;
  capture.abort.signal.addEventListener("abort", abort, { once: true });
  try {
    return await new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (capture.abort.signal.aborted || failure || !capture.isCurrent())
          return;
        if (bytes + event.data.size > MAX_AUDIO_BYTES) {
          failure = new Error("Voice recording exceeded the audio limit.");
          finish();
          return;
        }
        if (event.data.size) {
          bytes += event.data.size;
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        failure = new Error("Voice recording failed.");
        finish();
      };
      recorder.onstop = () => {
        stopTracks(capture);
        if (capture.abort.signal.aborted) reject(abortError());
        else if (failure) reject(failure);
        else
          resolve(
            new Blob(chunks, { type: recorder.mimeType || "audio/webm" }),
          );
      };
      if (capture.abort.signal.aborted) reject(abortError());
      else recorder.start(1000);
    });
  } finally {
    capture.abort.signal.removeEventListener("abort", abort);
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    capture.finish = undefined;
    finish();
    chunks.length = 0;
    stopTracks(capture);
  }
}

export function createVoiceRecording(
  onState: (state: VoiceState) => void,
  onError: (phase: VoiceFailure, error: unknown) => void,
) {
  let active = true;
  let current: Capture | undefined;
  const valid = (capture: Capture) =>
    active &&
    current === capture &&
    !capture.abort.signal.aborted &&
    capture.isCurrent();
  const cancel = (capture: Capture) => {
    const owned = current === capture;
    if (owned) current = undefined;
    clearTimer(capture);
    capture.abort.abort();
    stopTracks(capture);
    if (owned && active) onState("idle");
  };
  return {
    async start(input: Input): Promise<void> {
      if (!active || current || !input.isCurrent() || pending >= MAX_PENDING)
        return;
      const capture: Capture = {
        ...input,
        keys: { ...input.keys },
        options: { ...input.options },
        abort: new AbortController(),
      };
      current = capture;
      pending++;
      let phase: VoiceFailure =
        input.provider === "browser" ? "browser" : "microphone";
      try {
        onState("recording");
        if (!valid(capture)) throw abortError();
        capture.timer = setTimeout(() => {
          if (valid(capture) && capture.finish) capture.finish();
          else cancel(capture);
        }, MAX_CAPTURE_MS);
        let blob = new Blob();
        if (capture.provider !== "browser") {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          capture.stream = stream;
          if (!valid(capture)) throw abortError();
          blob = await record(capture, stream);
          clearTimer(capture);
          if (!valid(capture)) throw abortError();
          if (!blob.size) return;
          phase = "transcription";
          onState("transcribing");
        }
        if (!valid(capture)) throw abortError();
        const text = await transcribeAudio(
          blob,
          capture.provider,
          capture.keys,
          {
            ...capture.options,
            abortSignal: capture.abort.signal,
            onListening: (finish) => {
              capture.finish = finish;
            },
          },
        );
        if (!valid(capture)) return;
        if (text.length > 200_000)
          throw new Error("Voice transcript exceeded the text limit.");
        if (text.trim()) capture.onResult(text.trim());
      } catch (error) {
        if (valid(capture)) onError(phase, error);
      } finally {
        clearTimer(capture);
        capture.abort.abort();
        stopTracks(capture);
        pending--;
        if (current === capture) {
          current = undefined;
          if (active && capture.isCurrent()) onState("idle");
        }
      }
    },
    stop() {
      const capture = current;
      if (!capture) return;
      if (valid(capture) && capture.finish) capture.finish();
      else cancel(capture);
    },
    retire() {
      active = false;
      if (current) cancel(current);
    },
  };
}
