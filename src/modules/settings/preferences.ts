import { create } from "zustand";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  syncTrayLanguage,
  type Preferences,
} from "./store";
import { applyDocumentLocale } from "@/modules/i18n/direction";
import type { LanguageId } from "@/modules/i18n/types";

type State = Preferences & {
  hydrated: boolean;
  /** Subscribe & hydrate. Idempotent — safe to call from multiple windows. */
  init: () => Promise<void>;
};

let initPromise: Promise<void> | null = null;

const FAST_BG_KIND_KEY = "voktty-ui-bg-kind-shadow";
const FAST_BG_IMAGE_ID_KEY = "voktty-ui-bg-image-shadow";

function mirrorBgFastPath(
  kind: Preferences["backgroundKind"],
  imageId: Preferences["backgroundImageId"],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAST_BG_KIND_KEY, kind);
    if (imageId) window.localStorage.setItem(FAST_BG_IMAGE_ID_KEY, imageId);
    else window.localStorage.removeItem(FAST_BG_IMAGE_ID_KEY);
  } catch {
    /* ignore */
  }
}

export function readBgFastPath(): {
  active: boolean;
  imageId: string | null;
} {
  if (typeof window === "undefined") return { active: false, imageId: null };
  try {
    const kind = window.localStorage.getItem(FAST_BG_KIND_KEY);
    const imageId = window.localStorage.getItem(FAST_BG_IMAGE_ID_KEY);
    return { active: kind === "image" && !!imageId, imageId };
  } catch {
    return { active: false, imageId: null };
  }
}

export const usePreferencesStore = create<State>((set) => ({
  ...DEFAULT_PREFERENCES,
  hydrated: false,
  init: () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const prefs = await loadPreferences();
        set({ ...prefs, hydrated: true });
        applyDocumentLocale(prefs.language);
        void syncTrayLanguage(prefs.language);
        mirrorBgFastPath(prefs.backgroundKind, prefs.backgroundImageId);
        void onPreferencesChange((key, value) => {
          set({ [key]: value } as Partial<State>);
          if (key === "language") {
            applyDocumentLocale(value as LanguageId);
          }
          if (key === "backgroundKind" || key === "backgroundImageId") {
            const s = usePreferencesStore.getState();
            mirrorBgFastPath(s.backgroundKind, s.backgroundImageId);
          }
        });
      } catch (e) {
        initPromise = null;
        throw e;
      }
    })();
    return initPromise;
  },
}));
