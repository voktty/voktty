import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "@/components/ui/button";
import {
  ArrowRight01Icon,
  Globe02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { VokttyAnimatedLogo } from "@/modules/onboarding/VokttyAnimatedLogo";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  PORT_PRESETS,
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";
import {
  attachInspectorBridge,
  sendHighlightElement,
  sendInspectorActive,
  sendSelectElementBySelector,
  type InspectorBridge,
} from "./lib/inspectorBridge";
import { isLocalUrl } from "./lib/urlSafety";
import { useLiveComponentStore } from "./store/liveComponentStore";
import { usePreviewDevtoolsStore } from "./store/previewDevtoolsStore";

import { LiveComponentBadge } from "./components/LiveComponentBadge";
import { PreviewConsoleDrawer } from "./components/PreviewConsoleDrawer";
import { cn } from "@/lib/utils";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
  navigate: (url: string) => void;
  sendBrowserCommand: <T>(
    command: string,
    args?: unknown,
    timeoutMs?: number,
  ) => Promise<T>;
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
    const sendCommandRef = useRef<InspectorBridge["sendCommand"] | null>(null);

    const isInspectorActive = useLiveComponentStore((s) => s.isInspectorActive);
    const selectedComponent = useLiveComponentStore((s) => s.selectedComponent);
    const setSelectedComponent = useLiveComponentStore(
      (s) => s.setSelectedComponent,
    );
    const setInspectorActive = useLiveComponentStore(
      (s) => s.setInspectorActive,
    );
    const toggleInspector = useLiveComponentStore((s) => s.toggleInspector);

    const viewportMode = usePreviewDevtoolsStore((s) => s.viewportMode);
    const customWidth = usePreviewDevtoolsStore((s) => s.customWidth);
    const customHeight = usePreviewDevtoolsStore((s) => s.customHeight);
    const scale = usePreviewDevtoolsStore((s) => s.scale);
    const showDeviceFrame = usePreviewDevtoolsStore((s) => s.showDeviceFrame);
    const addConsoleEntry = usePreviewDevtoolsStore((s) => s.addConsoleEntry);
    const addNetworkEntry = usePreviewDevtoolsStore((s) => s.addNetworkEntry);

    const isFixedViewport =
      viewportMode !== "responsive" && Boolean(customWidth && customHeight);

    useEffect(() => {
      let cancelled = false;
      const normalized = (url ?? "").trim();
      if (
        !normalized ||
        normalized === "about:blank" ||
        normalized === "voktty://home" ||
        normalized === "voktty://start"
      ) {
        setEffectiveSrc("");
        return;
      }
      if (isLocalUrl(normalized)) {
        setEffectiveSrc(normalized);
        return;
      }
      invoke<string>("web_server_proxy_url", { targetUrl: normalized })
        .then((proxied) => {
          if (!cancelled) setEffectiveSrc(proxied);
        })
        .catch((err) => {
          console.warn("[PreviewPane] Failed to resolve proxy url:", err);
          if (!cancelled) setEffectiveSrc(normalized);
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

    // Custom events from UI for selector navigation
    useEffect(() => {
      const handleSelectBySelector = (
        e: Event,
      ) => {
        const ce = e as CustomEvent<{ selector: string; autoJump?: boolean }>;
        if (iframeRef.current && ce.detail?.selector) {
          sendSelectElementBySelector(
            iframeRef.current,
            ce.detail.selector,
            ce.detail.autoJump,
          );
        }
      };

      const handleHighlight = (e: Event) => {
        const ce = e as CustomEvent<{ selector: string }>;
        if (iframeRef.current && ce.detail?.selector) {
          sendHighlightElement(iframeRef.current, ce.detail.selector);
        }
      };

      window.addEventListener(
        "voktty:select-element-by-selector",
        handleSelectBySelector,
      );
      window.addEventListener("voktty:highlight-element", handleHighlight);

      return () => {
        window.removeEventListener(
          "voktty:select-element-by-selector",
          handleSelectBySelector,
        );
        window.removeEventListener("voktty:highlight-element", handleHighlight);
      };
    }, []);

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

      const bridge = attachInspectorBridge(
        iframe,
        (meta, autoJump) => {
          setSelectedComponent(
            meta,
            useLiveComponentStore.getState().activeWorkspaceRoot,
            autoJump,
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
        () => {
          setNonce((n) => n + 1);
        },
        (entry) => {
          addConsoleEntry(entry);
        },
        (entry) => {
          addNetworkEntry(entry);
        },
      );
      sendCommandRef.current = bridge.sendCommand;

      return () => {
        sendCommandRef.current = null;
        bridge.detach();
      };
    }, [
      loaded,
      nonce,
      effectiveSrc,
      setSelectedComponent,
      setInspectorActive,
      onUrlChange,
      addConsoleEntry,
      addNetworkEntry,
    ]);

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
        navigate: (nextUrl) => {
          onUrlChange(nextUrl);
        },
        sendBrowserCommand: (command, args, timeoutMs) => {
          const send = sendCommandRef.current;
          if (!send) {
            return Promise.reject(new Error("preview_bridge_unavailable"));
          }
          return send(command, args, timeoutMs);
        },
      }),
      [url, onUrlChange],
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
              ? isFixedViewport
                ? "relative min-h-0 flex-1 overflow-auto bg-slate-950/60 p-4 flex items-center justify-center"
                : "relative min-h-0 flex-1 bg-white"
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
              isFixedViewport ? (
                <div
                  style={{
                    width: customWidth!,
                    height: customHeight!,
                    transform: `scale(${scale})`,
                    transformOrigin: "center center",
                  }}
                  className={cn(
                    "relative shrink-0 overflow-hidden bg-white transition-all duration-150",
                    showDeviceFrame
                      ? "rounded-[24px] border-[10px] border-slate-800 shadow-2xl ring-1 ring-white/10"
                      : "border border-border/60 shadow-lg",
                  )}
                >
                  <iframe
                    ref={iframeRef}
                    key={`${effectiveSrc}#${nonce}`}
                    src={effectiveSrc}
                    title={t("preview.title")}
                    className="h-full w-full border-0 bg-white"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
                    referrerPolicy="no-referrer-when-downgrade"
                    allow="clipboard-read; clipboard-write; fullscreen"
                  />
                </div>
              ) : (
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
              )
            ) : (
              <SuspendedState
                onReload={() => {
                  setLoaded(true);
                  setNonce((n) => n + 1);
                }}
              />
            )
          ) : (
            <EmptyState onNavigate={onUrlChange} />
          )}
        </div>

        {/* Live DevTools Mini-Console Drawer */}
        {effectiveSrc ? <PreviewConsoleDrawer /> : null}
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

function EmptyState({ onNavigate }: { onNavigate?: (url: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const handleQuickNav = (targetUrl: string) => {
    onNavigate?.(targetUrl);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    if (
      /^https?:\/\//i.test(trimmed) ||
      /^localhost(:|\/|$)/i.test(trimmed) ||
      /^\d{1,3}(\.\d{1,3}){3}/.test(trimmed)
    ) {
      onNavigate?.(trimmed.startsWith("http") ? trimmed : `http://${trimmed}`);
    } else {
      onNavigate?.(
        `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
      );
    }
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center select-none bg-radial from-primary/5 via-background to-background">
      <div className="flex flex-col items-center gap-5 max-w-md w-full animate-in fade-in zoom-in-95 duration-300">
        {/* Animated Voktty Logo from Onboarding */}
        <div className="relative flex items-center justify-center p-3.5 rounded-2xl bg-card/50 border border-border/40 shadow-xl backdrop-blur-md">
          <VokttyAnimatedLogo size={100} />
        </div>

        {/* i18n Question & Subtitle */}
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight text-foreground font-sans">
            {t("preview.whatAreWeDebuggingToday")}
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("preview.enterUrlOrSearch")}
          </p>
        </div>

        {/* Search & URL Bar */}
        <form
          onSubmit={handleSearchSubmit}
          className="w-full relative flex items-center gap-1.5"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("preview.urlOrSearchPlaceholder")}
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-border/60 bg-muted/30 text-xs font-sans text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all shadow-xs"
            />
            <HugeiconsIcon
              icon={Search01Icon}
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={!query.trim()}
            className="h-9 px-3.5 rounded-xl text-xs gap-1.5 cursor-pointer"
          >
            <span>{t("common.open")}</span>
            <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
          </Button>
        </form>

        {/* Quick Local Presets */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
          {PORT_PRESETS.slice(0, 5).map((preset) => (
            <button
              key={preset.port}
              type="button"
              onClick={() => handleQuickNav(`http://localhost:${preset.port}`)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border/50 bg-card/60 hover:bg-accent text-[11px] text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-2xs font-mono"
              title={preset.hint}
            >
              <span className="size-1.5 rounded-full bg-primary/70" />
              <span>:{preset.port}</span>
              <span className="text-[10px] text-muted-foreground/70 font-sans">
                ({preset.label})
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


