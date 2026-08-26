import { routeAgentNotification } from "@/modules/agents/lib/route";
import { useWindowFocus } from "@/modules/agents/lib/useWindowFocus";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type { AgentStatus } from "@/modules/agents/lib/types";
import { playVokttySound } from "@/modules/sound";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chatStore";

const AGENT = "Voktty";

type RunStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "awaiting-approval"
  | "error";

function isBusy(s: RunStatus): boolean {
  return s === "thinking" || s === "streaming" || s === "awaiting-approval";
}

function liveStatus(s: RunStatus): AgentStatus | null {
  if (s === "awaiting-approval") return "waiting";
  if (s === "thinking" || s === "streaming") return "working";
  return null;
}

export function LocalAgentNotificationsBridge() {
  const status = useChatStore((s) => s.agentMeta.status) as RunStatus;
  const error = useChatStore((s) => s.agentMeta.error);
  const visible = useChatStore((s) => s.panelOpen || s.mini.open);
  const focused = useWindowFocus();

  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const prev = useRef<RunStatus>(status);
  const previousVisible = useRef<boolean | null>(null);

  useEffect(() => {
    const wasVisible = previousVisible.current;
    previousVisible.current = visible;
    if (wasVisible === null || wasVisible === visible) return;
    playVokttySound(visible ? "open" : "close", { retrigger: "restart" });
  }, [visible]);

  useEffect(() => {
    const currentLiveStatus = liveStatus(status);
    useAgentStore.getState().setLocalAgent(
      currentLiveStatus ? { agent: AGENT, status: currentLiveStatus } : null,
    );

    const was = prev.current;
    prev.current = status;
    if (was === status) return;

    const fire = (
      kind: "attention" | "finished" | "error",
      title: string,
      body?: string,
      playSound = true,
    ) =>
      routeAgentNotification({
        source: "local",
        agent: AGENT,
        kind,
        title,
        body,
        focused: focusedRef.current,
        visible: visibleRef.current,
        allowToast: true,
        playSound,
        onActivate: () => useChatStore.getState().openPanel(),
      });

    const becameBusy = isBusy(status) && !isBusy(was);
    if (becameBusy && usePreferencesStore.getState().agentNotificationSound) {
      playVokttySound("start", { retrigger: "restart" });
    }

    if (status === "awaiting-approval") {
      fire("attention", "Voktty needs your approval", "Approve a tool to continue");
    } else if (status === "error") {
      if (usePreferencesStore.getState().agentNotificationSound) {
        playVokttySound("error", { retrigger: "restart" });
      }
      fire("error", "Voktty run failed", error ?? undefined, false);
    } else if (status === "idle" && isBusy(was)) {
      if (usePreferencesStore.getState().agentNotificationSound) {
        playVokttySound("complete", { retrigger: "restart" });
      }
      fire("finished", "Voktty finished", "Your task is ready", false);
    }
  }, [status, error]);

  return null;
}
