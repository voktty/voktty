import type { LiveComponentMetadata } from "../types";
import { getInspectorInjectedScript } from "./inspectorScript";

export function attachInspectorBridge(
  iframe: HTMLIFrameElement,
  onSelected: (meta: LiveComponentMetadata) => void,
  onStateChange?: (active: boolean) => void,
  onReady?: () => void,
  onNavigate?: (url: string) => void,
): () => void {
  const handleMessage = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== "object") return;
    const { type, payload } = event.data as {
      type?: string;
      payload?: unknown;
    };

    if (type === "VOKTTY_LIVE_COMPONENT_SELECTED" && payload) {
      onSelected(payload as LiveComponentMetadata);
    } else if (type === "VOKTTY_INSPECTOR_STATE_CHANGE" && payload) {
      const { active } = payload as { active: boolean };
      onStateChange?.(active);
    } else if (type === "VOKTTY_PROXY_NAVIGATE" && payload) {
      const { url } = payload as { url: string };
      if (url) onNavigate?.(url);
    } else if (type === "VOKTTY_INSPECTOR_READY") {
      onReady?.();
    }
  };

  window.addEventListener("message", handleMessage);

  const injectIfPossible = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc && !doc.getElementById("voktty-injected-inspector")) {
        const script = doc.createElement("script");
        script.id = "voktty-injected-inspector";
        script.textContent = getInspectorInjectedScript();
        (doc.head || doc.body || doc.documentElement)?.appendChild(script);
      }
    } catch {
      // Cross-origin iframe: direct script injection via DOM throws,
      // which is expected. Message bridge continues listening.
    }
    onReady?.();
  };

  iframe.addEventListener("load", injectIfPossible);
  injectIfPossible();

  return () => {
    window.removeEventListener("message", handleMessage);
    iframe.removeEventListener("load", injectIfPossible);
  };
}

export function sendInspectorActive(
  iframe: HTMLIFrameElement | null,
  active: boolean,
): void {
  if (!iframe || !iframe.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(
      {
        type: "VOKTTY_SET_INSPECTOR_ACTIVE",
        active,
      },
      "*",
    );
  } catch (err) {
    console.warn("[Voktty Inspector] Failed to send active state", err);
  }
}
