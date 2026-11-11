// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const voice = vi.hoisted(() => ({
  state: {
    recording: false,
    transcribing: false,
    supported: true,
    hasKey: true,
  },
  start: vi.fn(),
  stop: vi.fn(),
  onResult: null as null | ((text: string) => void),
  isCurrent: null as null | (() => boolean),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@/modules/harness/chrome/useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: vi.fn() }),
}));
vi.mock("@/modules/ai/hooks/useWhisperRecording", () => ({
  useWhisperRecording: (options: {
    onResult: (text: string) => void;
    captureCurrent: () => (() => boolean) | null;
  }) => {
    voice.onResult = options.onResult;
    voice.isCurrent = options.captureCurrent();
    return {
      ...voice.state,
      state: voice.state.recording ? "recording" : "idle",
      start: voice.start,
      stop: voice.stop,
      sttProvider: "openai",
    };
  },
}));

import { Composer } from "@/modules/harness/chrome/Composer";

let root: Root;
let node: HTMLDivElement;
const onDraftChange = vi.fn();

async function render() {
  await act(async () =>
    root.render(
      <Composer
        focused={false}
        harness="codex"
        model=""
        runtimeMode="supervised"
        executionCwd="/project"
        initialDraft="revisa"
        hideTopBar
        onFocus={vi.fn()}
        onCwdChange={vi.fn()}
        onModelChange={vi.fn()}
        onRuntimeModeChange={vi.fn()}
        onSubmit={vi.fn()}
        onDraftChange={onDraftChange}
      />,
    ),
  );
}

function micButton() {
  return node.querySelector<HTMLButtonElement>('button[aria-label="Voice input"]');
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  voice.state = { recording: false, transcribing: false, supported: true, hasKey: true };
  voice.start.mockReset();
  voice.stop.mockReset();
  onDraftChange.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("starts dictation and appends the transcript to the draft", async () => {
  await render();
  const button = micButton();
  expect(button).not.toBeNull();
  await act(async () => button?.click());
  expect(voice.start).toHaveBeenCalledOnce();

  await act(async () => voice.onResult?.("el login de la 279"));
  const textarea = node.querySelector("textarea");
  expect(textarea?.value).toBe("revisa el login de la 279");
  expect(onDraftChange).toHaveBeenLastCalledWith("revisa el login de la 279");
});

it("stops an ongoing recording from the same button", async () => {
  voice.state.recording = true;
  await render();
  const button = node.querySelector<HTMLButtonElement>('button[aria-label="Stop & transcribe"]');
  await act(async () => button?.click());
  expect(voice.stop).toHaveBeenCalledOnce();
});

it("hides the microphone where speech capture is not available", async () => {
  voice.state.supported = false;
  await render();
  expect(micButton()).toBeNull();
});

it("does not own a recording after the composer unmounts", async () => {
  await render();
  const isCurrent = voice.isCurrent;
  expect(isCurrent?.()).toBe(true);
  await act(async () => root.unmount());
  expect(isCurrent?.()).toBe(false);
  root = createRoot(node);
});
