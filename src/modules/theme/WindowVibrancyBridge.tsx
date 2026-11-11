import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";
import { applyVibrancy, getWindowMaterials } from "./vibrancy";
import { resolveWindowMaterial, type WindowMaterial } from "./windowMaterial";

/** Main window only: `window_set_backdrop` targets its caller. */
export function WindowVibrancyBridge() {
  const enabled = usePreferencesStore((s) => s.windowVibrancy);
  const materialPref = usePreferencesStore((s) => s.windowMaterial);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const { resolvedMode, themeVariation, activeTheme } = useTheme();
  const [supported, setSupported] = useState<WindowMaterial[] | null>(null);

  useEffect(() => {
    let live = true;
    void getWindowMaterials().then((list) => {
      if (live) setSupported(list);
    });
    return () => {
      live = false;
    };
  }, []);

  const dark = resolvedMode === "dark";
  // Outside Windows 11 there is no material to pick; the platform's own
  // effect (macOS vibrancy) keeps working as before.
  const material =
    supported === null
      ? null
      : supported.length === 0
        ? "mica"
        : resolveWindowMaterial(
            materialPref ?? "auto",
            { variationId: themeVariation || null, skinId: activeTheme.skinId, dark },
            supported,
          );

  useEffect(() => {
    if (!hydrated || material === null) return;
    void applyVibrancy(enabled, dark, false, material);
  }, [enabled, hydrated, dark, material]);

  // Windows can silently reset the window's Mica dark/light attribute when
  // the OS broadcasts a system-wide theme change, even if Voktty's own
  // resolved mode above never changes (e.g. an explicit, non-"system" theme
  // pick). Re-assert the current state with `force` so the native backdrop
  // never drifts from what the webview content actually shows.
  const stateRef = useRef({ enabled, hydrated, dark, material });
  stateRef.current = { enabled, hydrated, dark, material };
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onOsChange = () => {
      const { enabled: on, hydrated: ready, dark: isDark, material: m } =
        stateRef.current;
      if (!ready || m === null) return;
      void applyVibrancy(on, isDark, true, m);
    };
    mq.addEventListener("change", onOsChange);
    return () => mq.removeEventListener("change", onOsChange);
  }, []);

  return null;
}
