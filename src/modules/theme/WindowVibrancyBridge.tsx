import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";
import { applyVibrancy } from "./vibrancy";

/** Main window only: `window_set_backdrop` targets its caller. */
export function WindowVibrancyBridge() {
  const enabled = usePreferencesStore((s) => s.windowVibrancy);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const { resolvedMode } = useTheme();

  useEffect(() => {
    if (!hydrated) return;
    void applyVibrancy(enabled, resolvedMode === "dark");
  }, [enabled, hydrated, resolvedMode]);

  // Windows can silently reset the window's Mica dark/light attribute when
  // the OS broadcasts a system-wide theme change, even if Voktty's own
  // resolved mode above never changes (e.g. an explicit, non-"system" theme
  // pick). Re-assert the current state with `force` so the native backdrop
  // never drifts from what the webview content actually shows.
  const stateRef = useRef({ enabled, hydrated, resolvedMode });
  stateRef.current = { enabled, hydrated, resolvedMode };
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onOsChange = () => {
      const { enabled: on, hydrated: ready, resolvedMode: mode } =
        stateRef.current;
      if (!ready) return;
      void applyVibrancy(on, mode === "dark", true);
    };
    mq.addEventListener("change", onOsChange);
    return () => mq.removeEventListener("change", onOsChange);
  }, []);

  return null;
}
