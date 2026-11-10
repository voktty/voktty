import { useCallback, useEffect, useRef } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setZoomLevel } from "@/modules/settings/store";
import { getOptimalInitialZoomLevel } from "@/lib/optimalZoom";

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const CSS_VAR = "--app-zoom";
const UI_SCALE_VAR = "--chrome-scale";

function clampZoom(z: number): number {
  const rounded = Math.round(z * 100) / 100;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

function applyToDom(z: number): void {
  document.documentElement.style.setProperty(CSS_VAR, String(z));
}

// Pre-initialize DOM style with resolution-aware zoom if not already set
if (
  typeof document !== "undefined" &&
  !document.documentElement.style.getPropertyValue(CSS_VAR)
) {
  applyToDom(getOptimalInitialZoomLevel());
}

export const UI_SCALE_MIN = 0.7;
export const UI_SCALE_MAX = 1.2;

/** Applies the chrome scale. Clamped so a bad stored value cannot make the UI unusable. */
export function applyUiScale(value: number): void {
  const safe = Number.isFinite(value)
    ? Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, value))
    : 1;
  document.documentElement.style.setProperty(UI_SCALE_VAR, String(safe));
}

export function useZoom() {
  const uiScale = usePreferencesStore((s) => s.uiScale);
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const lastAppliedRef = useRef<number | null>(null);

  useEffect(() => {
    applyUiScale(uiScale);
  }, [uiScale]);

  useEffect(() => {
    if (!hydrated) return;
    if (lastAppliedRef.current === zoomLevel) return;
    lastAppliedRef.current = zoomLevel;
    applyToDom(zoomLevel);
  }, [hydrated, zoomLevel]);

  const zoomIn = useCallback(() => {
    const current = usePreferencesStore.getState().zoomLevel;
    const next = clampZoom(current + ZOOM_STEP);
    if (next !== current) void setZoomLevel(next);
  }, []);

  const zoomOut = useCallback(() => {
    const current = usePreferencesStore.getState().zoomLevel;
    const next = clampZoom(current - ZOOM_STEP);
    if (next !== current) void setZoomLevel(next);
  }, []);

  const zoomReset = useCallback(() => {
    if (usePreferencesStore.getState().zoomLevel !== 1.0) {
      void setZoomLevel(1.0);
    }
  }, []);

  return { zoomIn, zoomOut, zoomReset };
}
