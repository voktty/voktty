import type { ConsoleEntry, LiveComponentMetadata, NetworkEntry } from "../types";
import { getInspectorInjectedScript } from "./inspectorScript";

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;

export type InspectorBridge = {
  detach: () => void;
  sendCommand: <T>(
    command: string,
    args?: unknown,
    timeoutMs?: number,
  ) => Promise<T>;
};

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export function targetOriginFor(iframe: { src: string }): string | null {
  const src = iframe.src.trim();
  if (!src) return null;
  try {
    const url = new URL(
      src,
      typeof globalThis.window !== "undefined"
        ? globalThis.window.location.href
        : undefined,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function postToFrame(iframe: HTMLIFrameElement, data: unknown): boolean {
  const win = iframe.contentWindow;
  const origin = targetOriginFor(iframe);
  if (!win || !origin) return false;
  try {
    win.postMessage(data, origin);
    return true;
  } catch (err) {
    console.warn("[Voktty Inspector] Failed to post to iframe", err);
    return false;
  }
}

export function attachInspectorBridge(
  iframe: HTMLIFrameElement,
  onSelected: (meta: LiveComponentMetadata, autoJump?: boolean) => void,
  onStateChange?: (active: boolean) => void,
  onReady?: () => void,
  onNavigate?: (url: string) => void,
  onReload?: () => void,
  onConsoleEntry?: (entry: ConsoleEntry) => void,
  onNetworkEntry?: (entry: Omit<NetworkEntry, "count">) => void,
): InspectorBridge {
  const pending = new Map<string, PendingCommand>();

  const settlePending = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    if (!event.data || typeof event.data !== "object") return;
    const data = event.data as {
      type?: string;
      payload?: unknown;
      autoJump?: boolean;
      requestId?: string;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    const { type, payload, autoJump, requestId } = data;

    if (type === "VOKTTY_BROWSER_RESULT") {
      if (typeof requestId !== "string") return;
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      if (data.ok) waiter.resolve(data.result);
      else {
        waiter.reject(
          new Error(
            typeof data.error === "string"
              ? data.error
              : "preview_command_failed",
          ),
        );
      }
      return;
    }

    if (type === "VOKTTY_LIVE_COMPONENT_SELECTED" && payload) {
      onSelected(payload as LiveComponentMetadata, Boolean(autoJump));
    } else if (type === "VOKTTY_INSPECTOR_STATE_CHANGE" && payload) {
      const { active } = payload as { active: boolean };
      onStateChange?.(active);
    } else if (type === "VOKTTY_CONSOLE_ENTRY" && payload) {
      onConsoleEntry?.(payload as ConsoleEntry);
    } else if (type === "VOKTTY_NETWORK_ENTRY" && payload) {
      onNetworkEntry?.(payload as Omit<NetworkEntry, "count">);
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
        script.textContent = getInspectorInjectedScript(window.location.origin);
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

  return {
    detach: () => {
      window.removeEventListener("message", handleMessage);
      iframe.removeEventListener("load", injectIfPossible);
      settlePending(new Error("preview_bridge_detached"));
    },
    sendCommand: <T>(
      command: string,
      args?: unknown,
      timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    ): Promise<T> => {
      const origin = targetOriginFor(iframe);
      const win = iframe.contentWindow;
      if (!win || !origin) {
        return Promise.reject(new Error("preview_origin_unresolved"));
      }
      const requestId = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("preview_command_timeout"));
        }, timeoutMs);
        pending.set(requestId, {
          resolve: (value) => {
            window.clearTimeout(timer);
            resolve(value as T);
          },
          reject: (error) => {
            window.clearTimeout(timer);
            reject(error);
          },
        });
        if (
          !postToFrame(iframe, {
            type: "VOKTTY_BROWSER_COMMAND",
            requestId,
            command,
            args,
          })
        ) {
          pending.delete(requestId);
          window.clearTimeout(timer);
          reject(new Error("preview_origin_unresolved"));
        }
      });
    },
  };
}

export function sendInspectorActive(
  iframe: HTMLIFrameElement | null,
  active: boolean,
): void {
  if (!iframe) return;
  postToFrame(iframe, {
    type: "VOKTTY_SET_INSPECTOR_ACTIVE",
    active,
  });
}

export function sendSelectElementBySelector(
  iframe: HTMLIFrameElement | null,
  selector: string,
  autoJump?: boolean,
): void {
  if (!iframe || !selector) return;
  postToFrame(iframe, {
    type: "VOKTTY_SELECT_ELEMENT_BY_SELECTOR",
    selector,
    autoJump: Boolean(autoJump),
  });
}

export function sendHighlightElement(
  iframe: HTMLIFrameElement | null,
  selector: string,
): void {
  if (!iframe || !selector) return;
  postToFrame(iframe, {
    type: "VOKTTY_HIGHLIGHT_ELEMENT",
    selector,
  });
}
