import { usePreferencesStore } from "@/modules/settings/preferences";
import { useTheme } from "@/modules/theme/ThemeProvider";
import { resolveEditorThemeId } from "@/modules/theme/resolveEditorTheme";
import type { Extension } from "@codemirror/state";
import { useMemo } from "react";
import { EDITOR_THEME_EXT } from "./themes";

/** Resolves the active CodeMirror theme extension, honoring the "auto" pairing. */
export function useEditorThemeExt(): Extension {
  const pref = usePreferencesStore((s) => s.editorTheme);
  const { themeId, themeVariation, customThemes, resolvedMode } = useTheme();
  return useMemo(() => {
    const id = resolveEditorThemeId(
      pref,
      themeId,
      customThemes,
      resolvedMode,
      themeVariation,
    );
    return EDITOR_THEME_EXT[id] ?? EDITOR_THEME_EXT.atomone;
  }, [pref, themeId, themeVariation, customThemes, resolvedMode]);
}
