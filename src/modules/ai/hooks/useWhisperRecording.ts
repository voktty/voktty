import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { t } from "@/modules/i18n";
import { formatAiError } from "@/modules/ai/lib/errors";
import {
  createVoiceRecording,
  type VoiceState,
} from "@/modules/ai/lib/ownedVoiceRecording";
import type { SttProvider } from "@/modules/ai/config";
import type { ProviderKeys } from "@/modules/ai/lib/keyring";

function hasProviderKey(provider: SttProvider, keys: ProviderKeys) {
  return (
    provider === "whispercpp" || provider === "browser" || !!keys[provider]
  );
}
function supportsProvider(provider: SttProvider) {
  if (provider === "browser") {
    if (typeof window === "undefined") return false;
    const browser = window as unknown as Record<string, unknown>;
    return (
      typeof (browser.SpeechRecognition ?? browser.webkitSpeechRecognition) ===
      "function"
    );
  }
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export function useWhisperRecording({
  onResult,
  captureCurrent,
}: {
  onResult: (text: string) => void;
  captureCurrent: () => (() => boolean) | null;
}) {
  const apiKeys = useChatStore((state) => state.apiKeys);
  const sttProvider = usePreferencesStore((state) => state.sttProvider);
  const [state, setState] = useState<VoiceState>("idle");
  const current = useRef<{
    binding: typeof captureCurrent;
    recording: ReturnType<typeof createVoiceRecording>;
  } | null>(null);

  useLayoutEffect(() => {
    const view = {
      binding: captureCurrent,
      recording: createVoiceRecording(setState, (phase, error) => {
        const key =
          phase === "microphone"
            ? "feedback.microphoneAccessFailed"
            : phase === "browser"
              ? "feedback.speechRecognitionFailed"
              : "feedback.transcriptionFailed";
        toast.error(t(key), { description: formatAiError(error) });
      }),
    };
    current.current = view;
    setState("idle");
    return () => {
      if (current.current === view) current.current = null;
      view.recording.retire();
    };
  }, [captureCurrent]);

  const start = useCallback(async () => {
    const view = current.current;
    if (view?.binding !== captureCurrent) return;
    const isCurrent = captureCurrent();
    if (!isCurrent?.()) return;
    const keys = { ...useChatStore.getState().apiKeys };
    const config = usePreferencesStore.getState();
    const provider = config.sttProvider;
    if (!supportsProvider(provider) || !hasProviderKey(provider, keys)) return;
    await view.recording.start({
      provider,
      keys,
      isCurrent,
      onResult,
      options: {
        groqSttModel: config.groqSttModel,
        whispercppBaseURL: config.whispercppBaseURL,
      },
    });
  }, [captureCurrent, onResult]);
  const stop = useCallback(() => {
    const view = current.current;
    if (view?.binding === captureCurrent) view.recording.stop();
  }, [captureCurrent]);

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    start,
    stop,
    supported: state !== "idle" || supportsProvider(sttProvider),
    hasKey: state !== "idle" || hasProviderKey(sttProvider, apiKeys),
    sttProvider,
  };
}
