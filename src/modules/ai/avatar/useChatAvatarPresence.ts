import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../store/chatStore";
import { chatPresence, makePresence, type AvatarPresence } from "./presence";
import { playAvatarPresenceSound } from "./sound";

const SUCCESS_PULSE_MS = 1400;

export function useChatAvatarPresence(): AvatarPresence {
  const meta = useChatStore((state) => state.agentMeta);
  const previousStatus = useRef(meta.status);
  const previousPresenceState = useRef<AvatarPresence["state"]>("idle");
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const wasBusy = previousStatus.current !== "idle";
    previousStatus.current = meta.status;
    if (!wasBusy || meta.status !== "idle") return;

    setShowSuccess(true);
    const timeout = window.setTimeout(
      () => setShowSuccess(false),
      SUCCESS_PULSE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [meta.status]);

  const presence = showSuccess
    ? makePresence("success")
    : chatPresence({
        status: meta.status,
        step: meta.step,
        approvalsPending: meta.approvalsPending,
      });

  useEffect(() => {
    const previous = previousPresenceState.current;
    previousPresenceState.current = presence.state;
    playAvatarPresenceSound(previous, presence.state);
  }, [presence.state]);

  return presence;
}
