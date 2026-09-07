import type { LiveComponentMetadata } from "../types";
import { useLiveComponentStore } from "../store/liveComponentStore";
import { usePreviewDevtoolsStore } from "../store/previewDevtoolsStore";
import { usePreviewHandleStore } from "../store/previewHandleStore";
import { isLocalUrl } from "./urlSafety";

export const NO_ACTIVE_PREVIEW = {
  ok: false as const,
  error: "no_active_preview",
  message:
    "No active preview tab is available. Open a localhost preview first.",
};

export type BrowserTarget = {
  ref?: number;
  selector?: string;
  tabId?: number;
};

function resolveHandle(tabId?: number) {
  const store = usePreviewHandleStore.getState();
  if (tabId != null) return store.getHandle(tabId);
  return store.getActiveHandle();
}

async function send<T>(
  command: string,
  args?: unknown,
  tabId?: number,
): Promise<{ ok: true; result: T } | { ok: false; error: string; message: string }> {
  const handle = resolveHandle(tabId);
  if (!handle) return NO_ACTIVE_PREVIEW;
  try {
    const result = await handle.sendBrowserCommand<T>(command, args);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, message };
  }
}

export function getBrowserSelected():
  | { selected: false; message: string }
  | { selected: true; component: LiveComponentMetadata } {
  const component = useLiveComponentStore.getState().selectedComponent;
  if (!component) {
    return {
      selected: false,
      message:
        "No live component is currently selected in the browser. Toggle inspection with Ctrl+G and click an element.",
    };
  }
  return { selected: true, component };
}

export function getBrowserNetworkLog() {
  return {
    ok: true as const,
    entries: usePreviewDevtoolsStore.getState().networkEntries,
  };
}

export function runBrowserSnapshot(tabId?: number) {
  return send("snapshot", undefined, tabId);
}

export function runBrowserClick(target: BrowserTarget) {
  return send("click", { ref: target.ref, selector: target.selector }, target.tabId);
}

export function runBrowserType(
  target: BrowserTarget & { text: string; submit?: boolean },
) {
  return send(
    "type",
    {
      ref: target.ref,
      selector: target.selector,
      text: target.text,
      submit: Boolean(target.submit),
    },
    target.tabId,
  );
}

export function runBrowserEval(script: string, tabId?: number) {
  return send("eval", { script }, tabId);
}

export function runBrowserNavigate(url: string, tabId?: number) {
  if (!isLocalUrl(url)) {
    return {
      ok: false as const,
      error: "url_not_local",
      message:
        "Preview navigation is restricted to localhost URLs. Paste an external URL into the address bar instead.",
      url,
    };
  }
  const handle = resolveHandle(tabId);
  if (!handle) return { ...NO_ACTIVE_PREVIEW, url };
  handle.navigate(url);
  return { ok: true as const, url };
}
