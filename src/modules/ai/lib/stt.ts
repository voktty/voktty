import type { ProviderKeys } from "./keyring";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const STT_TIMEOUT_GROQ_MS = 30_000;
const STT_TIMEOUT_WHISPERCPP_MS = 180_000;

function assertCurrent(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Voice transcription retired.", "AbortError");
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number,
  signal?: AbortSignal,
  failurePrefix = "STT",
): Promise<string> {
  assertCurrent(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.text();
    assertCurrent(signal);
    if (!response.ok) {
      throw new Error(
        `${failurePrefix} request failed (${response.status}): ${body || response.statusText}`,
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function transcribeOpenAI(
  blob: Blob,
  apiKey: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const [{ createOpenAI }, { experimental_transcribe: transcribe }] =
    await Promise.all([import("@ai-sdk/openai"), import("ai")]);
  assertCurrent(abortSignal);
  const openai = createOpenAI({ apiKey });
  const buf = new Uint8Array(await blob.arrayBuffer());
  assertCurrent(abortSignal);
  const { text } = await transcribe({
    model: openai.transcription("whisper-1"),
    audio: buf,
    abortSignal,
  });
  assertCurrent(abortSignal);
  return text;
}

async function transcribeViaRest(
  baseURL: string,
  blob: Blob,
  apiKey: string | null,
  model: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("file", blob, "audio.webm");
  form.append("model", model);
  form.append("response_format", "text");

  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  return fetchWithTimeout(
    `${baseURL}/audio/transcriptions`,
    {
      method: "POST",
      headers,
      body: form,
    },
    STT_TIMEOUT_GROQ_MS,
    abortSignal,
  );
}

async function toWav(blob: Blob, abortSignal?: AbortSignal): Promise<Blob> {
  assertCurrent(abortSignal);
  const ctx = new AudioContext();
  try {
    const bytes = await blob.arrayBuffer();
    assertCurrent(abortSignal);
    const buf = await ctx.decodeAudioData(bytes);
    assertCurrent(abortSignal);
    const length = buf.length;
    const sampleRate = buf.sampleRate;
    const channel = buf.getChannelData(0);
    const dataLen = length * 2;
    const buffer = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buffer);

    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++)
        view.setUint8(offset + i, s.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataLen, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    ctx.close();
  }
}

async function transcribeWhisperCpp(
  baseURL: string,
  blob: Blob,
  abortSignal?: AbortSignal,
): Promise<string> {
  const wav = await toWav(blob, abortSignal);
  assertCurrent(abortSignal);
  const form = new FormData();
  form.append("file", wav, "audio.wav");
  form.append("response_format", "text");

  return fetchWithTimeout(
    `${baseURL}/inference`,
    {
      method: "POST",
      body: form,
    },
    STT_TIMEOUT_WHISPERCPP_MS,
    abortSignal,
    "Whisper.cpp",
  );
}

// Offline provider: never POST recorded audio to a non-loopback host.
function assertLoopbackUrl(baseURL: string): void {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error(`Invalid Whisper.cpp URL: ${baseURL}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback =
    host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
  if (!loopback) {
    throw new Error(
      "Whisper.cpp must run on a loopback address (localhost or 127.x.x.x) to keep transcription local.",
    );
  }
}

// ---------------------------------------------------------------------------
// Browser built-in (Web Speech API) — no API key, no server needed.
// Works in WebView2 (Windows), WebKitGTK (Linux), WebKit (macOS/iOS).
// Returns a Promise that resolves with the final transcript when the user
// stops speaking (or rejects if the API is unavailable / the mic is denied).
// ---------------------------------------------------------------------------

type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: SpeechRecognitionResultList;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type AnySpeechRecognitionCtor = new () => BrowserRecognition;

function getSpeechRecognitionCtor(): AnySpeechRecognitionCtor | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"]) as
    | AnySpeechRecognitionCtor
    | undefined;
}

function transcribeBrowser(options: SttOptions): Promise<string> {
  assertCurrent(options.abortSignal);
  return new Promise((resolve, reject) => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      reject(
        new Error("Web Speech API is not supported in this browser/WebView."),
      );
      return;
    }
    const recognition = new SR();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    let finalTranscript = "";
    let done = false;
    let stopping = false;
    const settle = (error?: unknown) => {
      if (done) return;
      done = true;
      options.abortSignal?.removeEventListener("abort", abort);
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      if (error) reject(error);
      else resolve(finalTranscript.trim());
    };
    const abort = () => {
      settle(new DOMException("Voice transcription retired.", "AbortError"));
      try {
        recognition.abort();
      } catch {}
    };
    options.abortSignal?.addEventListener("abort", abort, { once: true });

    recognition.onresult = (event: {
      resultIndex: number;
      results: SpeechRecognitionResultList;
    }) => {
      if (done) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
          if (finalTranscript.length > 200_000) {
            settle(new Error("Voice transcript exceeded the text limit."));
            try {
              recognition.abort();
            } catch {}
            return;
          }
        }
      }
    };
    recognition.onend = () => settle();
    recognition.onerror = (event: { error: string }) => {
      settle(new Error(`Speech recognition error: ${event.error}`));
      try {
        recognition.abort();
      } catch {}
    };

    try {
      assertCurrent(options.abortSignal);
      recognition.start();
      if (!done)
        options.onListening?.(() => {
          if (done || stopping) return;
          stopping = true;
          try {
            recognition.stop();
          } catch (error) {
            settle(error);
            try {
              recognition.abort();
            } catch {}
          }
        });
    } catch (error) {
      settle(error);
      try {
        recognition.abort();
      } catch {}
    }
  });
}

export type SttOptions = {
  groqSttModel?: string;
  whispercppBaseURL?: string;
  abortSignal?: AbortSignal;
  onListening?: (finish: () => void) => void;
};

export async function transcribeAudio(
  blob: Blob,
  provider: import("../config").SttProvider,
  apiKeys: ProviderKeys,
  options: SttOptions = {},
): Promise<string> {
  assertCurrent(options.abortSignal);
  switch (provider) {
    case "openai": {
      const key = apiKeys.openai;
      if (!key) throw new Error("OpenAI API key is not configured");
      return transcribeOpenAI(blob, key, options.abortSignal);
    }
    case "groq": {
      const key = apiKeys.groq;
      if (!key) throw new Error("Groq API key is not configured");
      const model = options.groqSttModel || "whisper-large-v3-turbo";
      return transcribeViaRest(
        GROQ_BASE_URL,
        blob,
        key,
        model,
        options.abortSignal,
      );
    }
    case "whispercpp": {
      const baseURL =
        options.whispercppBaseURL?.replace(/\/+$/, "") ||
        "http://127.0.0.1:8080";
      assertLoopbackUrl(baseURL);
      return transcribeWhisperCpp(baseURL, blob, options.abortSignal);
    }
    case "browser": {
      // The blob is ignored — the browser handles capture internally.
      return transcribeBrowser(options);
    }
  }
}
