import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_THEME_ID,
  loadPreferences,
  onPreferencesChange,
  setTheme as persistTheme,
  setThemeId as persistThemeId,
  type ThemePref,
} from "@/modules/settings/store";
import { applyTheme, clearTheme, isDarkColor } from "./applyTheme";
import {
  listCustomThemes,
  onCustomThemesChange,
} from "./customThemes";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { SurfaceLayer } from "./SurfaceLayer";
import { getBuiltinTheme, getDefaultTheme } from "./themes";
import type { Theme } from "./types";

export type { Theme };
export type ThemeModePref = ThemePref;

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultMode?: ThemePref;
};

type ThemeProviderState = {
  mode: ThemePref;
  resolvedMode: "dark" | "light";
  themeId: string;
  activeTheme: Theme;
  customThemes: Theme[];
  setMode: (mode: ThemePref) => void;
  setThemeId: (id: string) => void;
  /** Apply a theme transiently without persisting; null reverts to committed. */
  previewThemeId: (id: string | null) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

const FAST_PATH_KEY = "voktty-ui-theme-shadow";
const FAST_PATH_THEME_ID = "voktty-ui-theme-id-shadow";

function readFastMode(fallback: ThemePref): ThemePref {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(FAST_PATH_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : fallback;
}

function writeFastMode(t: ThemePref): void {
  try { window.localStorage.setItem(FAST_PATH_KEY, t); } catch { /* ignore */ }
}

function readFastThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  return window.localStorage.getItem(FAST_PATH_THEME_ID) ?? DEFAULT_THEME_ID;
}

function writeFastThemeId(id: string): void {
  try { window.localStorage.setItem(FAST_PATH_THEME_ID, id); } catch { /* ignore */ }
}

function resolveTheme(id: string, custom: Theme[]): Theme {
  return custom.find((t) => t.id === id) ?? getBuiltinTheme(id) ?? getDefaultTheme();
}

export function ThemeProvider({ children, defaultMode = "system" }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemePref>(() => readFastMode(defaultMode));
  const [themeId, setThemeIdState] = useState<string>(() => readFastThemeId());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    let alive = true;
    void loadPreferences().then((p) => {
      if (!alive) return;
      setModeState(p.theme);
      setThemeIdState(p.themeId);
      writeFastMode(p.theme);
      writeFastThemeId(p.themeId);
    });
    const unlistenP = onPreferencesChange((key, value) => {
      if (key === "theme" && (value === "system" || value === "light" || value === "dark")) {
        setModeState(value);
        writeFastMode(value);
      } else if (key === "themeId" && typeof value === "string") {
        setThemeIdState(value);
        writeFastThemeId(value);
      }
    });
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void listCustomThemes().then((list) => { if (alive) setCustomThemes(list); });
    const unlisten = onCustomThemesChange(() => {
      void listCustomThemes().then((list) => setCustomThemes(list));
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const rawResolvedMode: "dark" | "light" =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  const windowVibrancy = usePreferencesStore((s) => s.windowVibrancy);
  const vibrancyOpacity = usePreferencesStore((s) => s.vibrancyOpacity);

  const effectiveId = previewId ?? themeId;
  const activeTheme = useMemo(
    () => resolveTheme(effectiveId, customThemes),
    [effectiveId, customThemes],
  );

  const resolvedMode: "dark" | "light" = useMemo(() => {
    if (effectiveId === DEFAULT_THEME_ID) return rawResolvedMode;
    const directVariant = activeTheme.variants[rawResolvedMode];
    if (directVariant && (Object.keys(directVariant.colors ?? {}).length > 0 || directVariant.terminal)) {
      const bg = directVariant.colors?.background;
      return bg ? (isDarkColor(bg) ? "dark" : "light") : rawResolvedMode;
    }
    if (activeTheme.variants.dark && (!activeTheme.variants.light || Object.keys(activeTheme.variants.light?.colors ?? {}).length === 0)) {
      const bg = activeTheme.variants.dark.colors?.background;
      return bg ? (isDarkColor(bg) ? "dark" : "light") : "dark";
    }
    if (activeTheme.variants.light && (!activeTheme.variants.dark || Object.keys(activeTheme.variants.dark?.colors ?? {}).length === 0)) {
      const bg = activeTheme.variants.light.colors?.background;
      return bg ? (isDarkColor(bg) ? "dark" : "light") : "light";
    }
    return rawResolvedMode;
  }, [effectiveId, activeTheme, rawResolvedMode]);

  useEffect(() => {
    if (effectiveId === DEFAULT_THEME_ID) {
      const root = document.documentElement;
      root.classList.remove("light", "dark", "theme-light");
      root.classList.add(resolvedMode);
      root.classList.toggle("theme-light", resolvedMode === "light");
    }
  }, [resolvedMode, effectiveId]);

  useEffect(() => {
    if (effectiveId === DEFAULT_THEME_ID) {
      clearTheme();
      if (windowVibrancy) {
        document.documentElement.style.setProperty(
          "--vibrancy-opacity",
          String(vibrancyOpacity),
        );
      }
      return;
    }
    applyTheme(activeTheme, resolvedMode, windowVibrancy, vibrancyOpacity);
  }, [
    effectiveId,
    activeTheme,
    resolvedMode,
    windowVibrancy,
    vibrancyOpacity,
  ]);

  const setMode = useCallback((next: ThemePref) => {
    setModeState(next);
    writeFastMode(next);
    void persistTheme(next);
  }, []);

  const setThemeId = useCallback((id: string) => {
    setPreviewId(null);
    setThemeIdState(id);
    writeFastThemeId(id);
    void persistThemeId(id);
  }, []);

  const previewThemeId = useCallback((id: string | null) => {
    setPreviewId(id);
  }, []);

  const value = useMemo<ThemeProviderState>(
    () => ({
      mode,
      resolvedMode,
      themeId,
      activeTheme,
      customThemes,
      setMode,
      setThemeId,
      previewThemeId,
    }),
    [
      mode,
      resolvedMode,
      themeId,
      activeTheme,
      customThemes,
      setMode,
      setThemeId,
      previewThemeId,
    ],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      <SurfaceLayer />
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
  return ctx;
}
