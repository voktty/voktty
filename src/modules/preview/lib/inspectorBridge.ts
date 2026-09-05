import type { ConsoleEntry, LiveComponentMetadata } from "../types";
import { getInspectorInjectedScript } from "./inspectorScript";

export function attachInspectorBridge(
  iframe: HTMLIFrameElement,
  onSelected: (meta: LiveComponentMetadata, autoJump?: boolean) => void,
  onStateChange?: (active: boolean) => void,
  onReady?: () => void,
  onNavigate?: (url: string) => void,
  onReload?: () => void,
  onConsoleEntry?: (entry: ConsoleEntry) => void,
): () => void {
  const handleMessage = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== "object") return;
    const { type, payload, autoJump } = event.data as {
      type?: string;
      payload?: unknown;
      autoJump?: boolean;
    };

    if (type === "VOKTTY_LIVE_COMPONENT_SELECTED" && payload) {
      onSelected(payload as LiveComponentMetadata, Boolean(autoJump));
    } else if (type === "VOKTTY_INSPECTOR_STATE_CHANGE" && payload) {
      const { active } = payload as { active: boolean };
      onStateChange?.(active);
    } else if (type === "VOKTTY_CONSOLE_ENTRY" && payload) {
      onConsoleEntry?.(payload as ConsoleEntry);
    } else if (type === "VOKTTY_PROXY_NAVIGATE" && payload) {
      const { url } = payload as { url: string };
      if (url) onNavigate?.(url);
    } else if (type === "VOKTTY_RELOAD_PREVIEW") {
      onReload?.();
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

export function sendSelectElementBySelector(
  iframe: HTMLIFrameElement | null,
  selector: string,
  autoJump?: boolean,
): void {
  if (!iframe || !iframe.contentWindow || !selector) return;
  try {
    iframe.contentWindow.postMessage(
      {
        type: "VOKTTY_SELECT_ELEMENT_BY_SELECTOR",
        selector,
        autoJump: Boolean(autoJump),
      },
      "*",
    );
  } catch (err) {
    console.warn("[Voktty Inspector] Failed to select element by selector", err);
  }
}

export function sendHighlightElement(
  iframe: HTMLIFrameElement | null,
  selector: string,
): void {
  if (!iframe || !iframe.contentWindow || !selector) return;
  try {
    iframe.contentWindow.postMessage(
      {
        type: "VOKTTY_HIGHLIGHT_ELEMENT",
        selector,
      },
      "*",
    );
  } catch (err) {
    console.warn("[Voktty Inspector] Failed to highlight element", err);
  }
}

