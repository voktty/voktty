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
  DEFAULT_THEME_VARIATION,
  loadPreferences,
  onPreferencesChange,
  setTheme as persistTheme,
  setThemeId as persistThemeId,
  setThemeVariation as persistThemeVariation,
  setAppearancePack as persistAppearancePack,
  setSurfaceProfile as persistSurfaceProfile,
  setTypographyProfile as persistTypographyProfile,
  type ThemePref,
} from "@/modules/settings/store";
import { applyTheme, clearTheme, isDarkColor } from "./applyTheme";
import {
  listCustomThemes,
  onCustomThemesChange,
} from "./customThemes";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { SurfaceLayer } from "./SurfaceLayer";
import { isLegacyVariationId } from "./legacyThemeIds";
import {
  getLoadedBuiltinTheme,
  getLoadedDefaultTheme,
  loadBuiltinTheme,
} from "./themeLoader";
import { resolveAppearanceSelection } from "./resolveAppearanceSelection";
import type { Theme } from "./types";
import { getBackdropKind } from "./vibrancy";
import {
  applyStructuralTraits,
  resolveStructuralTraits,
  type ResolvedAppearance,
} from "./resolveStructuralTraits";

export type { Theme };
export type ThemeModePref = ThemePref;

/** Fired on `window` whenever the app's resolved theme mode changes (detail:
 * "dark" | "light"). Lets plain-JS consumers outside the React tree (e.g. the
 * harness's imperative xterm setup) react without re-running a `useTheme()`
 * effect that would remount their own resource. */
export const THEME_CHANGED_EVENT = "voktty:theme-changed";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultMode?: ThemePref;
};

type ThemeProviderState = {
  mode: ThemePref;
  resolvedMode: "dark" | "light";
  themeId: string;
  themeVariation: string;
  appearancePack: string;
  surfaceProfile: string;
  typographyProfile: string;
  resolvedAppearance: ResolvedAppearance;
  activeTheme: Theme;
  customThemes: Theme[];
  setMode: (mode: ThemePref) => void;
  setThemeId: (id: string) => void;
  setThemeVariation: (variation: string) => void;
  setAppearancePack: (pack: string) => void;
  setSurfaceProfile: (profile: string) => void;
  setTypographyProfile: (profile: string) => void;
  /** Apply a theme transiently without persisting; null reverts to committed. */
  previewThemeId: (id: string | null) => void;
  previewVariation: (variation: string | null) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

const FAST_PATH_KEY = "voktty-ui-theme-shadow";
const FAST_PATH_THEME_ID = "voktty-ui-theme-id-shadow";
const FAST_PATH_THEME_VARIATION = "voktty-ui-theme-variation-shadow";

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

function readFastThemeVariation(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_VARIATION;
  return (
    window.localStorage.getItem(FAST_PATH_THEME_VARIATION) ??
    DEFAULT_THEME_VARIATION
  );
}

function writeFastThemeVariation(variation: string): void {
  try {
    window.localStorage.setItem(FAST_PATH_THEME_VARIATION, variation);
  } catch {
    /* ignore */
  }
}

function resolveTheme(id: string, custom: Theme[]): Theme {
  return custom.find((t) => t.id === id) ?? getLoadedBuiltinTheme(id) ?? getLoadedDefaultTheme();
}

export function ThemeProvider({ children, defaultMode = "system" }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemePref>(() => readFastMode(defaultMode));
  const [themeId, setThemeIdState] = useState<string>(() => readFastThemeId());
  const [themeVariation, setThemeVariationState] = useState<string>(() =>
    readFastThemeVariation(),
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewVariationId, setPreviewVariationId] = useState<string | null>(
    null,
  );
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [loadedThemeId, setLoadedThemeId] = useState(() => readFastThemeId());
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
      setThemeVariationState(p.themeVariation);
      writeFastMode(p.theme);
      writeFastThemeId(p.themeId);
      writeFastThemeVariation(p.themeVariation);
    });
    const unlistenP = onPreferencesChange((key, value) => {
      if (key === "theme" && (value === "system" || value === "light" || value === "dark")) {
        setModeState(value);
        writeFastMode(value);
      } else if (key === "themeId" && typeof value === "string") {
        setThemeIdState(value);
        writeFastThemeId(value);
      } else if (key === "themeVariation" && typeof value === "string") {
        setThemeVariationState(value);
        writeFastThemeVariation(value);
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
  const appearancePackPref = usePreferencesStore((s) => s.appearancePack);
  const surfaceProfilePref = usePreferencesStore((s) => s.surfaceProfile);
  const typographyProfilePref = usePreferencesStore((s) => s.typographyProfile);

  // Themes with vibrancy on bake semi-transparent colors straight into
  // inline styles, assuming the OS is actually blurring what's behind the
  // window (Mica/Acrylic on Windows, NSVisualEffectView on macOS). Most
  // Linux compositors have no such API, so without this check those themes
  // would render as raw, unblurred see-through UI there regardless of the
  // user's vibrancy preference.
  const [backdropAvailable, setBackdropAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void getBackdropKind().then((kind) => {
      if (alive) setBackdropAvailable(kind !== "none");
    });
    return () => {
      alive = false;
    };
  }, []);
  const vibrancyActive = windowVibrancy && backdropAvailable;

  const selection = useMemo(
    () =>
      resolveAppearanceSelection({
        themeId,
        variationId: themeVariation,
        appearancePack: appearancePackPref,
        previewThemeId: previewId,
        previewVariationId,
      }),
    [themeId, themeVariation, appearancePackPref, previewId, previewVariationId],
  );
  const effectiveId = selection.themeId;
  const effectiveVariationId = selection.variationId;

  useEffect(() => {
    let alive = true;
    const requestedThemeId =
      effectiveId === DEFAULT_THEME_ID ? effectiveVariationId : effectiveId;
    void loadBuiltinTheme(requestedThemeId).then(() => {
      if (alive) setLoadedThemeId(requestedThemeId);
    });
    return () => {
      alive = false;
    };
  }, [effectiveId, effectiveVariationId]);

  const baseTheme = useMemo(
    () => resolveTheme(effectiveId, customThemes),
    [effectiveId, customThemes, loadedThemeId],
  );

  const activeVariation = useMemo(() => {
    if (!baseTheme.variations || baseTheme.variations.length === 0) return null;
    return (
      baseTheme.variations.find((v) => v.id === effectiveVariationId) ??
      baseTheme.variations.find((v) => v.id === baseTheme.defaultVariation) ??
      baseTheme.variations[0]
    );
  }, [baseTheme, effectiveVariationId]);

  const activeTheme: Theme = useMemo(() => {
    if (!activeVariation) return baseTheme;
    return {
      ...baseTheme,
      variants: activeVariation.variants,
      editorTheme: activeVariation.editorTheme ?? baseTheme.editorTheme,
    };
  }, [baseTheme, activeVariation]);

  const isDefaultObsidian =
    effectiveId === DEFAULT_THEME_ID &&
    (!activeVariation || activeVariation.id === "default");

  const resolvedMode: "dark" | "light" = useMemo(() => {
    if (isDefaultObsidian) return rawResolvedMode;
    const directVariant = activeTheme.variants[rawResolvedMode];
    if (
      directVariant &&
      (Object.keys(directVariant.colors ?? {}).length > 0 || directVariant.terminal)
    ) {
      const bg = directVariant.colors?.background;
      return bg ? (isDarkColor(bg) ? "dark" : "light") : rawResolvedMode;
    }
    if (
      activeTheme.variants.dark &&
      (!activeTheme.variants.light ||
        Object.keys(activeTheme.variants.light?.colors ?? {}).length === 0)
    ) {
      const bg = activeTheme.variants.dark.colors?.background;
      return bg ? (isDarkColor(bg) ? "dark" : "light") : "dark";
    }
    if (
      activeTheme.variants.light &&
      (!activeTheme.variants.dark ||
        Object.keys(activeTheme.variants.dark?.colors ?? {}).length === 0)
    ) {
      const bg = activeTheme.variants.light.colors?.background;
      return bg ? (isDarkColor(bg) ? "dark" : "light") : "light";
    }
    return rawResolvedMode;
  }, [isDefaultObsidian, activeTheme, rawResolvedMode]);

  const resolvedAppearance = useMemo(() => {
    return resolveStructuralTraits({
      theme: activeTheme,
      variation: activeVariation,
      userOverrides: {
        appearancePack: appearancePackPref,
        surfaceProfile: surfaceProfilePref,
        typographyProfile: typographyProfilePref,
      },
    });
  }, [
    activeTheme,
    activeVariation,
    appearancePackPref,
    surfaceProfilePref,
    typographyProfilePref,
  ]);

  useEffect(() => {
    if (isDefaultObsidian) {
      const root = document.documentElement;
      root.classList.remove("light", "dark", "theme-light");
      root.classList.add(resolvedMode);
      root.classList.toggle("theme-light", resolvedMode === "light");
    }
  }, [resolvedMode, isDefaultObsidian]);

  useEffect(() => {
    if (isDefaultObsidian) {
      clearTheme();
      applyStructuralTraits(
        resolvedAppearance.traits,
        resolvedAppearance.surfaceProfile,
        resolvedAppearance.materialProfile,
      );
      if (vibrancyActive) {
        document.documentElement.style.setProperty(
          "--vibrancy-opacity",
          String(vibrancyOpacity),
        );
      }
      return;
    }
    applyTheme(activeTheme, resolvedMode, vibrancyActive, vibrancyOpacity);
    applyStructuralTraits(
      resolvedAppearance.traits,
      resolvedAppearance.surfaceProfile,
      resolvedAppearance.materialProfile,
    );
  }, [
    isDefaultObsidian,
    activeTheme,
    resolvedMode,
    vibrancyActive,
    vibrancyOpacity,
    resolvedAppearance,
  ]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<"dark" | "light">(THEME_CHANGED_EVENT, {
        detail: resolvedMode,
      }),
    );
  }, [resolvedMode]);

  const setMode = useCallback((next: ThemePref) => {
    setModeState(next);
    writeFastMode(next);
    void persistTheme(next);
  }, []);

  const setThemeId = useCallback((id: string) => {
    const legacyVar = isLegacyVariationId(id);
    if (legacyVar) {
      setPreviewId(null);
      setPreviewVariationId(null);
      setThemeIdState(DEFAULT_THEME_ID);
      setThemeVariationState(legacyVar);
      writeFastThemeId(DEFAULT_THEME_ID);
      writeFastThemeVariation(legacyVar);
      void persistThemeId(DEFAULT_THEME_ID);
      void persistThemeVariation(legacyVar);
      void persistAppearancePack("default");
      return;
    }
    setPreviewId(null);
    setPreviewVariationId(null);
    setThemeIdState(id);
    writeFastThemeId(id);
    void persistThemeId(id);
    void persistAppearancePack("default");
  }, []);

  const setThemeVariation = useCallback((variation: string) => {
    setPreviewVariationId(null);
    setThemeVariationState(variation);
    writeFastThemeVariation(variation);
    void persistThemeVariation(variation);
    void persistAppearancePack("default");
  }, []);

  const setAppearancePack = useCallback((pack: string) => {
    void persistAppearancePack(pack);
  }, []);

  const setSurfaceProfile = useCallback((profile: string) => {
    void persistSurfaceProfile(profile);
  }, []);

  const setTypographyProfile = useCallback((profile: string) => {
    void persistTypographyProfile(profile);
  }, []);

  const previewThemeId = useCallback((id: string | null) => {
    setPreviewId(id);
  }, []);

  const previewVariation = useCallback((variation: string | null) => {
    setPreviewVariationId(variation);
  }, []);

  const value = useMemo<ThemeProviderState>(
    () => ({
      mode,
      resolvedMode,
      themeId: effectiveId,
      themeVariation: effectiveVariationId,
      appearancePack: appearancePackPref,
      surfaceProfile: surfaceProfilePref,
      typographyProfile: typographyProfilePref,
      resolvedAppearance,
      activeTheme,
      customThemes,
      setMode,
      setThemeId,
      setThemeVariation,
      setAppearancePack,
      setSurfaceProfile,
      setTypographyProfile,
      previewThemeId,
      previewVariation,
    }),
    [
      mode,
      resolvedMode,
      effectiveId,
      effectiveVariationId,
      appearancePackPref,
      surfaceProfilePref,
      typographyProfilePref,
      resolvedAppearance,
      activeTheme,
      customThemes,
      setMode,
      setThemeId,
      setThemeVariation,
      setAppearancePack,
      setSurfaceProfile,
      setTypographyProfile,
      previewThemeId,
      previewVariation,
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
