import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";
import {
  attachInspectorBridge,
  sendInspectorActive,
} from "./lib/inspectorBridge";
import { useLiveComponentStore } from "./store/liveComponentStore";

import { LiveComponentBadge } from "./components/LiveComponentBadge";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
};

// Tear the iframe down after this much invisibility — a background dev
// server page can hold hundreds of MB inside the WebView.
const SUSPEND_AFTER_MS = 30_000;

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ url, visible, onUrlChange }, ref) {
    const { t } = useTranslation();
    // `nonce` is part of the iframe `key`. Bumping it remounts the iframe,
    // which is the only reliable cross-origin reload (calling
    // contentWindow.location.reload() throws on cross-origin frames).
    const [nonce, setNonce] = useState(0);
    const [loaded, setLoaded] = useState(visible);
    const [effectiveSrc, setEffectiveSrc] = useState(url);
    const addressRef = useRef<PreviewAddressBarHandle>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const isInspectorActive = useLiveComponentStore((s) => s.isInspectorActive);
    const selectedComponent = useLiveComponentStore((s) => s.selectedComponent);
    const setSelectedComponent = useLiveComponentStore(
      (s) => s.setSelectedComponent,
    );
    const setInspectorActive = useLiveComponentStore(
      (s) => s.setInspectorActive,
    );
    const toggleInspector = useLiveComponentStore((s) => s.toggleInspector);

    useEffect(() => {
      let cancelled = false;
      if (!url) {
        setEffectiveSrc("");
        return;
      }
      if (isLocalUrl(url)) {
        setEffectiveSrc(url);
        return;
      }
      invoke<string>("web_server_proxy_url", { targetUrl: url })
        .then((proxied) => {
          if (!cancelled) setEffectiveSrc(proxied);
        })
        .catch((err) => {
          console.warn("[PreviewPane] Failed to resolve proxy url:", err);
          if (!cancelled) setEffectiveSrc(url);
        });

      return () => {
        cancelled = true;
      };
    }, [url]);

    // Live-reload: automatically refresh the iframe when local files change or are saved
    useEffect(() => {
      if (!loaded) return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const triggerReload = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          setNonce((n) => n + 1);
        }, 120);
      };

      const unlistenWritten = getCurrentWebviewWindow().listen<unknown>(
        "fs:file-written",
        triggerReload,
      );
      const unlistenChanged = getCurrentWebviewWindow().listen<unknown>(
        "fs:changed",
        triggerReload,
      );

      const handleCustomEvent = () => triggerReload();
      window.addEventListener("voktty:reload-preview", handleCustomEvent);

      return () => {
        if (timer) clearTimeout(timer);
        window.removeEventListener("voktty:reload-preview", handleCustomEvent);
        unlistenWritten.then((unlisten) => unlisten());
        unlistenChanged.then((unlisten) => unlisten());
      };
    }, [loaded]);

    useEffect(() => {
      if (visible) {
        setLoaded(true);
        return;
      }
      const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
      return () => clearTimeout(t);
    }, [visible]);

    // Keyboard shortcut: Ctrl+G / Cmd+G / Ctrl+Shift+C to toggle component inspector
    useEffect(() => {
      if (!visible) return;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c")
        ) {
          e.preventDefault();
          e.stopPropagation();
          toggleInspector();
        }
      };
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [visible, toggleInspector]);

    // Inspector bridge & message listener
    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe || !loaded) return;

      const detach = attachInspectorBridge(
        iframe,
        (meta) => {
          setSelectedComponent(
            meta,
            useLiveComponentStore.getState().activeWorkspaceRoot,
          );
        },
        (active) => {
          setInspectorActive(active);
        },
        () => {
          sendInspectorActive(
            iframe,
            useLiveComponentStore.getState().isInspectorActive,
          );
        },
        (newUrl) => {
          onUrlChange(newUrl);
        },
      );

      return () => {
        detach();
      };
    }, [loaded, nonce, effectiveSrc, setSelectedComponent, setInspectorActive, onUrlChange]);

    // Sync active state with iframe
    useEffect(() => {
      if (iframeRef.current && loaded) {
        sendInspectorActive(iframeRef.current, isInspectorActive);
      }
    }, [isInspectorActive, loaded, nonce, effectiveSrc]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          setLoaded(true);
          setNonce((n) => n + 1);
        },
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => url,
      }),
      [url],
    );

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <PreviewAddressBar
          ref={addressRef}
          url={url}
          onSubmit={onUrlChange}
          onReload={() => setNonce((n) => n + 1)}
        />
        <div
          className={
            effectiveSrc
              ? "relative min-h-0 flex-1 bg-white"
              : "relative min-h-0 flex-1 bg-background"
          }
        >
          {selectedComponent ? (
            <div className="absolute top-3 inset-x-3 sm:inset-x-6 z-30 max-w-3xl mx-auto pointer-events-auto">
              <LiveComponentBadge />
            </div>
          ) : null}
          {effectiveSrc ? (
            loaded ? (
              <iframe
                ref={iframeRef}
                key={`${effectiveSrc}#${nonce}`}
                src={effectiveSrc}
                title={t("preview.title")}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
                referrerPolicy="no-referrer-when-downgrade"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : (
              <SuspendedState
                onReload={() => {
                  setLoaded(true);
                  setNonce((n) => n + 1);
                }}
              />
            )
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    );
  },
);

function SuspendedState({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium text-foreground">
          {t("preview.suspendedTitle")}
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
          {t("preview.suspendedDesc")}
        </p>
      </div>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-border/60 bg-card px-3 py-1 text-[11px] hover:bg-accent/50"
      >
        {t("preview.reload")}
      </button>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          {t("preview.emptyTitle")}
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {t("preview.emptyDesc")}
        </p>
      </div>
    </div>
  );
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "[::1]" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
