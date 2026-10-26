// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWhisperRecording } from "@/modules/ai/hooks/useWhisperRecording";
import { usePreferencesStore } from "@/modules/settings/preferences";

const fixture = vi.hoisted(() => ({
  media: vi.fn(),
  transcribe: vi.fn(),
  error: vi.fn(),
  records: [] as FakeRecorder[],
}));
vi.mock("@/modules/ai/lib/stt", () => ({
  transcribeAudio: fixture.transcribe,
}));
vi.mock("sonner", () => ({ toast: { error: fixture.error } }));
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
    fixture.records.push(this);
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
  data(data = new Blob(["fixture audio"])) {
    this.ondataavailable?.({ data });
  }
}
function deferred<T>() {
  let finish: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
let voice: ReturnType<typeof useWhisperRecording>;
let root: Root | null;
const onResult = vi.fn();
const preferences = usePreferencesStore.getState();
function View({ capture }: { capture: () => (() => boolean) | null }) {
  voice = useWhisperRecording({ onResult, captureCurrent: capture });
  return null;
}
async function render(capture: () => (() => boolean) | null) {
  await act(async () => {
    root?.render(createElement(View, { capture }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.records.length = 0;
  fixture.transcribe.mockReset().mockResolvedValue("original text");
  fixture.error.mockReset();
  onResult.mockReset();
  fixture.media.mockReset();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", {
    language: "en",
    mediaDevices: { getUserMedia: fixture.media },
  });
  usePreferencesStore.setState({ sttProvider: "whispercpp" });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
    root = null;
  });
  usePreferencesStore.setState({ sttProvider: preferences.sttProvider });
  vi.unstubAllGlobals();
});

it("stops late microphone permission without starting a retired recorder", async () => {
  const permission = deferred<unknown>();
  const stop = vi.fn();
  fixture.media.mockReturnValue(permission.promise);
  await render(() => () => true);
  await act(async () => {
    void voice.start();
  });
  await act(async () => {
    root?.unmount();
    root = null;
  });
  await act(async () => {
    permission.finish({ getTracks: () => [{ stop }] });
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(fixture.records).toHaveLength(0);
  expect(fixture.transcribe).not.toHaveBeenCalled();
});

it("never uploads recording data when its presentation unmounts", async () => {
  const stop = vi.fn();
  fixture.media.mockResolvedValue({ getTracks: () => [{ stop }] });
  await render(() => () => true);
  await act(async () => {
    void voice.start();
  });
  fixture.records[0].data();
  await act(async () => {
    root?.unmount();
    root = null;
  });
  expect(fixture.transcribe).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(onResult).not.toHaveBeenCalled();
});

it("suppresses a late transcript after its original conversation retires", async () => {
  const transcript = deferred<string>();
  const stop = vi.fn();
  fixture.media.mockResolvedValue({ getTracks: () => [{ stop }] });
  fixture.transcribe.mockReturnValue(transcript.promise);
  let active = true;
  await render(() => () => active);
  await act(async () => {
    void voice.start();
  });
  fixture.records[0].data();
  await act(async () => voice.stop());
  expect(fixture.transcribe).toHaveBeenCalledTimes(1);
  active = false;
  await render(() => () => true);
  await act(async () => {
    transcript.finish("late original text");
  });
  expect(onResult).not.toHaveBeenCalled();
  expect(fixture.error).not.toHaveBeenCalled();
});

it("coalesces microphone starts before permission returns", async () => {
  const permission = deferred<unknown>();
  const stop = vi.fn();
  fixture.media.mockReturnValue(permission.promise);
  await render(() => () => true);
  await act(async () => {
    void voice.start();
    void voice.start();
  });
  expect(fixture.media).toHaveBeenCalledTimes(1);
  await act(async () => {
    voice.stop();
    permission.finish({ getTracks: () => [{ stop }] });
  });
});

it("does not open the microphone for a stale start callback", async () => {
  fixture.media.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  let active = true;
  await render(() => () => active);
  const start = voice.start;
  active = false;
  await render(() => () => true);
  await act(async () => {
    void start();
  });
  expect(fixture.media).not.toHaveBeenCalled();
});

it("transcribes normal Stop once and releases the original microphone", async () => {
  const stop = vi.fn();
  fixture.media.mockResolvedValue({ getTracks: () => [{ stop }] });
  await render(() => () => true);
  await act(async () => {
    void voice.start();
  });
  fixture.records[0].data();
  await act(async () => voice.stop());
  expect(fixture.transcribe).toHaveBeenCalledTimes(1);
  expect(onResult).toHaveBeenCalledExactlyOnceWith("original text");
  expect(stop).toHaveBeenCalledTimes(1);
  expect(voice.state).toBe("idle");
});

it("refuses oversized recording data before transcription", async () => {
  const stop = vi.fn();
  fixture.media.mockResolvedValue({ getTracks: () => [{ stop }] });
  await render(() => () => true);
  await act(async () => {
    void voice.start();
  });
  await act(async () =>
    fixture.records[0].data(new Blob([new Uint8Array(16 * 1024 * 1024 + 1)])),
  );
  expect(fixture.transcribe).not.toHaveBeenCalled();
  expect(fixture.error).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
});

it("keeps one live microphone and result under StrictMode", async () => {
  const stop = vi.fn();
  fixture.media.mockResolvedValue({ getTracks: () => [{ stop }] });
  const capture = () => () => true;
  await act(async () => {
    root?.render(
      createElement(StrictMode, null, createElement(View, { capture })),
    );
  });
  await act(async () => {
    void voice.start();
  });
  fixture.records[0].data();
  await act(async () => voice.stop());
  expect(fixture.media).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(onResult).toHaveBeenCalledTimes(1);
});
