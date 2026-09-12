import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  EDITOR_THEME_AUTO,
  EDITOR_THEME_LABELS,
  EDITOR_THEME_MODE,
  EDITOR_THEMES,
  type EditorThemePref,
  setBackgroundBlur,
  setBackgroundImageId,
  setBackgroundKind,
  setBackgroundOpacity,
  setEditorTheme,
  setVibrancyOpacity,
  setWindowVibrancy,
} from "@/modules/settings/store";
import { useTheme } from "@/modules/theme/ThemeProvider";
import {
  listBuiltinAppearancePacks,
  listBuiltinSurfaceProfiles,
  listBuiltinTypographyProfiles,
} from "@/modules/theme/packs";
import {
  deleteBgImage,
  importBgImageFromFile,
} from "@/modules/theme/bgImageStore";
import {
  deleteCustomTheme,
  saveCustomTheme,
} from "@/modules/theme/customThemes";
import { deleteThemeFile, emitThemeEdit } from "@/modules/theme/themeFiles";
import { resolveThemeDescription } from "@/modules/theme/themeDescription";
import { listBuiltinThemes } from "@/modules/theme/themes";
import { DEFAULT_THEME_ID } from "@/modules/theme/types";
import { validateTheme } from "@/modules/theme/validateTheme";
import {
  type Backdrop,
  getBackdropKind,
} from "@/modules/theme/vibrancy";
import { Edit02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function ThemesSection() {
  const { t } = useTranslation();
  const {
    themeId,
    setThemeId,
    themeVariation,
    setThemeVariation,
    appearancePack,
    setAppearancePack,
    surfaceProfile,
    setSurfaceProfile,
    typographyProfile,
    setTypographyProfile,
    resolvedMode,
    customThemes,
  } = useTheme();
  const builtinThemes = listBuiltinThemes();
  const themes = useMemo(
    () => [...builtinThemes, ...customThemes],
    [builtinThemes, customThemes],
  );
  const selectedTheme = useMemo(
    () => themes.find((t) => t.id === themeId) ?? themes[0],
    [themes, themeId],
  );
  const customIds = useMemo(
    () => new Set(customThemes.map((t) => t.id)),
    [customThemes],
  );

  const [importError, setImportError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const onCreateTheme = () => {
    void emitThemeEdit({ action: "create" });
    void getCurrentWindow().hide();
  };

  const onEditTheme = (id: string) => {
    void emitThemeEdit({ action: "edit", id });
    void getCurrentWindow().hide();
  };

  const editorThemePref = usePreferencesStore((s) => s.editorTheme);
  const backgroundKind = usePreferencesStore((s) => s.backgroundKind);
  const backgroundImageId = usePreferencesStore((s) => s.backgroundImageId);
  const backgroundOpacity = usePreferencesStore((s) => s.backgroundOpacity);
  const backgroundBlur = usePreferencesStore((s) => s.backgroundBlur);
  const windowVibrancy = usePreferencesStore((s) => s.windowVibrancy);
  const vibrancyOpacity = usePreferencesStore((s) => s.vibrancyOpacity);

  const [backdrop, setBackdrop] = useState<Backdrop>("none");
  useEffect(() => {
    let alive = true;
    void getBackdropKind().then((k) => {
      if (alive) setBackdrop(k);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleThemeFiles = async (files: FileList | null) => {
    setImportError(null);
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const result = validateTheme(parsed);
        if (!result.ok) {
          setImportError(`${file.name}: ${result.error}`);
          return;
        }
        await saveCustomTheme(result.theme);
        setThemeId(result.theme.id);
      } catch (e) {
          setImportError(
            e instanceof Error
              ? `${file.name}: ${e.message}`
              : t("feedback.themeReadFailed", { file: file.name }),
          );
        return;
      }
    }
  };

  const onPickThemeFile = () => fileInputRef.current?.click();

  const onRemoveCustomTheme = async (id: string) => {
    if (themeId === id) setThemeId(DEFAULT_THEME_ID);
    await deleteCustomTheme(id);
    void deleteThemeFile(id);
  };

  const onPickBgFile = () => bgInputRef.current?.click();

  const handleBgFiles = async (files: FileList | null) => {
    setBgError(null);
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      setBgError(t("feedback.themeNotImage", { file: file.name }));
      return;
    }
    try {
      const prev = backgroundImageId;
      const { id } = await importBgImageFromFile(file);
      await setBackgroundImageId(id);
      await setBackgroundKind("image");
      if (prev && prev !== id) await deleteBgImage(prev).catch(() => undefined);
    } catch (e) {
      setBgError(
        e instanceof Error ? e.message : t("feedback.themeImportFailed"),
      );
    }
  };

  const onRemoveBackground = async () => {
    setBgError(null);
    const prev = backgroundImageId;
    await setBackgroundKind("none");
    await setBackgroundImageId(null);
    if (prev) await deleteBgImage(prev).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("settings.themes.title")}
        description={t("settings.themes.description")}
      />

      {backdrop === "none" ? null : (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-[12.5px] font-medium">
                {backdrop === "mica"
                  ? t("settings.themes.background.backdropMica")
                  : t("settings.themes.background.backdropVibrancy")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {backdrop === "mica"
                  ? t("settings.themes.background.backdropMicaDesc")
                  : t("settings.themes.background.backdropVibrancyDesc")}
              </span>
            </div>
            <Switch
              checked={windowVibrancy}
              onCheckedChange={(v) => void setWindowVibrancy(v)}
            />
          </div>

          {windowVibrancy ? (
            <div className="flex flex-col gap-2 border-t border-border/40 pt-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px] text-muted-foreground">
                  {t("settings.themes.background.vibrancyOpacity")}
                </span>
                <span className="tabular-nums text-[11px] text-muted-foreground">
                  {Math.round(vibrancyOpacity * 100)}%
                </span>
              </div>
              <Slider
                value={[vibrancyOpacity]}
                min={0.2}
                max={1}
                step={0.01}
                onValueChange={(v) => void setVibrancyOpacity(v[0] ?? 0.85)}
              />
              <span className="text-[10.5px] text-muted-foreground">
                {t("settings.themes.background.vibrancyOpacityDesc")}
              </span>
            </div>
          ) : null}
        </div>
      )}

      <div
        role="presentation"
        className="flex flex-col gap-2"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          void handleThemeFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center justify-between">
          <Label>{t("settings.themes.appThemes.title")}</Label>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={onCreateTheme}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={11} strokeWidth={2} />
              {t("settings.themes.appThemes.createTheme")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onPickThemeFile}
            >
              {t("settings.themes.appThemes.importTheme")}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".voktty-theme,.json,application/json"
            className="hidden"
            onChange={(e) => {
              void handleThemeFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {importError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive">
            {importError}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {themes.map((theme) => {
            const isSelected = themeId === theme.id;
            const activeVar =
              isSelected && theme.variations
                ? theme.variations.find((va) => va.id === themeVariation) ??
                  theme.variations[0]
                : theme.variations?.[0];

            const v =
              activeVar?.variants[resolvedMode] ??
              activeVar?.variants.dark ??
              activeVar?.variants.light ??
              theme.variants[resolvedMode] ??
              theme.variants.dark ??
              theme.variants.light;
            const c = v?.colors;
            const swatchBg = c?.background ?? (resolvedMode === "light" ? "#f4f5f8" : "#121214");
            const swatchFg = c?.foreground ?? (resolvedMode === "light" ? "#18191c" : "#f4f4f6");
            const swatchAccent =
              activeVar?.accentColor ?? c?.primary ?? c?.accent ?? "var(--accent)";
            const swatchMuted = c?.muted ?? (resolvedMode === "light" ? "#e5e7eb" : "#262932");
            const isCustom = customIds.has(theme.id);
            const description = isCustom
              ? theme.description
              : resolveThemeDescription(t, theme, isSelected ? activeVar : undefined);
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setThemeId(theme.id)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border p-2.5 text-left transition-all",
                  isSelected
                    ? "border-foreground/60 ring-1 ring-foreground/20"
                    : "border-border/60 hover:border-border",
                )}
              >
                <div
                  className="flex h-10 w-14 shrink-0 items-center justify-center gap-1 rounded-md border border-border/40 shadow-xs"
                  style={{ background: swatchBg }}
                >
                  <span
                    className="h-5 w-2 rounded-sm"
                    style={{ background: swatchAccent }}
                  />
                  <span
                    className="h-5 w-2 rounded-sm"
                    style={{ background: swatchFg, opacity: 0.7 }}
                  />
                  <span
                    className="h-5 w-2 rounded-sm"
                    style={{ background: swatchMuted }}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium">
                      {theme.name}
                    </span>
                    {theme.variations && theme.variations.length > 0 ? (
                      <span
                        className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-medium text-primary border border-primary/20 shrink-0"
                        title={`${theme.variations.length} ${t("settings.themes.variations.title")}`}
                      >
                        <span className="flex items-center -space-x-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        </span>
                        <span>{t("settings.themes.variations.matrixHint")}</span>
                      </span>
                    ) : null}
                  </div>
                  {description ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {description}
                    </span>
                  ) : null}
                </div>
                {isCustom ? (
                  <span className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <span
                      role="button"
                      aria-label={t("settings.themes.appThemes.editTheme", {
                        name: theme.name,
                      })}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTheme(theme.id);
                      }}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        size={12}
                        strokeWidth={1.75}
                      />
                    </span>
                    <span
                      role="button"
                      aria-label={t("settings.themes.appThemes.removeTheme", {
                        name: theme.name,
                      })}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onRemoveCustomTheme(theme.id);
                      }}
                    >
                      ×
                    </span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {selectedTheme?.variations && selectedTheme.variations.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/20 p-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[11.5px] font-medium text-foreground">
                  {t("settings.themes.variations.title")}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  ({selectedTheme.variations.length})
                </span>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">
                {selectedTheme.variations.find((v) => v.id === themeVariation)?.name ?? ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {selectedTheme.variations.map((variation) => {
                const varVariant =
                  variation.variants[resolvedMode] ??
                  variation.variants.dark ??
                  variation.variants.light;
                const varColors = varVariant?.colors;
                const varBg =
                  varColors?.background ??
                  (resolvedMode === "light" ? "#f4f5f8" : "#121214");
                const varAccent =
                  variation.accentColor ??
                  varColors?.primary ??
                  varColors?.accent ??
                  "var(--accent)";
                const isVariationSelected = themeVariation === variation.id;

                return (
                  <button
                    key={variation.id}
                    type="button"
                    title={variation.name}
                    aria-label={variation.name}
                    onClick={() => setThemeVariation(variation.id)}
                    className={cn(
                      "relative flex h-6.5 w-6.5 items-center justify-center rounded-full transition-all cursor-pointer p-0.5",
                      isVariationSelected
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110 shadow-xs"
                        : "opacity-75 hover:opacity-100 hover:scale-105",
                    )}
                  >
                    <div
                      className="h-full w-full rounded-full border border-border/60 overflow-hidden flex shadow-xs"
                      style={{ background: varBg }}
                    >
                      <div className="h-full w-1/2" style={{ background: varBg }} />
                      <div className="h-full w-1/2" style={{ background: varAccent }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <Label>
              {t("settings.themes.pack.title")}
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {t("settings.themes.pack.desc")}
            </span>
          </div>
          <Select
            value={appearancePack || "default"}
            onValueChange={(v) => void setAppearancePack(v)}
          >
            <SelectTrigger size="sm" className="h-8 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {listBuiltinAppearancePacks().map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-[12px]">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <Label>
              {t("settings.themes.typography.title")}
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {t("settings.themes.typography.desc")}
            </span>
          </div>
          <Select
            value={typographyProfile || "auto"}
            onValueChange={(v) => void setTypographyProfile(v)}
          >
            <SelectTrigger size="sm" className="h-8 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-[12px]">
                {t("settings.themes.autoFollow")}
              </SelectItem>
              <SelectSeparator />
              {listBuiltinTypographyProfiles().map((tp) => (
                <SelectItem key={tp.id} value={tp.id} className="text-[12px]">
                  {tp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <Label>
              {t("settings.themes.surface.title")}
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {t("settings.themes.surface.desc")}
            </span>
          </div>
          <Select
            value={surfaceProfile || "auto"}
            onValueChange={(v) => void setSurfaceProfile(v)}
          >
            <SelectTrigger size="sm" className="h-8 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-[12px]">
                {t("settings.themes.autoFollow")}
              </SelectItem>
              <SelectSeparator />
              {listBuiltinSurfaceProfiles().map((sp) => (
                <SelectItem key={sp.id} value={sp.id} className="text-[12px]">
                  {sp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <Label>{t("settings.editor.display.themeTitle")}</Label>
            <span className="text-[11px] text-muted-foreground">
              {t("settings.editor.display.themeDesc")}
            </span>
          </div>
          <Select
            value={editorThemePref}
            onValueChange={(v) => void setEditorTheme(v as EditorThemePref)}
          >
            <SelectTrigger size="sm" className="h-8 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EDITOR_THEME_AUTO} className="text-[12px]">
                {t("settings.editor.display.themeAuto")}
              </SelectItem>
              <SelectSeparator />
              {[...EDITOR_THEMES]
                .sort(
                  (a, b) =>
                    (EDITOR_THEME_MODE[a] === resolvedMode ? 0 : 1) -
                    (EDITOR_THEME_MODE[b] === resolvedMode ? 0 : 1),
                )
                .map((id) => (
                  <SelectItem
                    key={id}
                    value={id}
                    disabled={EDITOR_THEME_MODE[id] !== resolvedMode}
                    className="text-[12px]"
                  >
                    {EDITOR_THEME_LABELS[id]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        role="presentation"
        className="flex flex-col gap-2"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          void handleBgFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center justify-between">
          <Label>{t("settings.themes.background.title")}</Label>
          <div className="flex items-center gap-2">
            {backgroundKind === "image" && backgroundImageId ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => void onRemoveBackground()}
              >
                {t("common.remove")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onPickBgFile}
            >
              {backgroundKind === "image" ? t("settings.themes.background.selectImage") : t("settings.themes.background.selectImage")}
            </Button>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleBgFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {bgError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive">
            {bgError}
          </div>
        ) : null}
        {backgroundKind === "image" && backgroundImageId ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-muted-foreground">
                {t("settings.themes.background.opacity")}
              </span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {Math.round(backgroundOpacity * 100)}%
              </span>
            </div>
            <Slider
              value={[backgroundOpacity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(v) => void setBackgroundOpacity(v[0] ?? 0)}
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11.5px] text-muted-foreground">{t("settings.themes.background.blur")}</span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {backgroundBlur}px
              </span>
            </div>
            <Slider
              value={[backgroundBlur]}
              min={0}
              max={64}
              step={1}
              onValueChange={(v) => void setBackgroundBlur(v[0] ?? 0)}
            />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {t("settings.themes.background.dropHint")}
          </p>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
