import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { useTheme, type Theme } from "@/modules/theme/ThemeProvider";
import {
  builtinThemeCatalog,
  resolveCatalogTheme,
} from "@/modules/theme/themeCatalog";
import { resolveThemeDescription } from "@/modules/theme/themeDescription";
import {
  nextVariationIdForTheme,
  resolveThemeSwatch,
} from "@/modules/theme/themeSwatch";

export function OnboardingThemePicker() {
  const { t } = useTranslation();
  const {
    themeId,
    themeVariation,
    setThemeId,
    setThemeVariation,
    resolvedMode,
    customThemes,
    activeTheme,
  } = useTheme();
  const themes = [...builtinThemeCatalog, ...customThemes];
  const selectedTheme =
    customThemes.find((theme) => theme.id === themeId) ??
    resolveCatalogTheme(themeId, activeTheme) ??
    themes[0];
  const variations = selectedTheme?.variations ?? [];

  const handleSelectTheme = (theme: Theme) => {
    void setThemeId(theme.id);
    const nextVariation = nextVariationIdForTheme(theme, themeVariation);
    if (nextVariation && nextVariation !== themeVariation) {
      void setThemeVariation(nextVariation);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-foreground/80">
        {t("onboarding.themeLabel")}
      </label>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {themes.map((theme) => {
          const selected = themeId === theme.id;
          const swatch = resolveThemeSwatch(
            theme,
            selected ? themeVariation : (theme.defaultVariation ?? "default"),
            resolvedMode,
          );
          const description = resolveThemeDescription(
            t,
            theme,
            selected ? variations.find((variation) => variation.id === themeVariation) : undefined,
          );
          return (
            <button
              key={theme.id}
              type="button"
              aria-label={description ? `${theme.name}: ${description}` : theme.name}
              aria-pressed={selected}
              onClick={() => handleSelectTheme(theme)}
              className={cn(
                "flex items-center gap-2 rounded-lg border p-1.5 text-left transition-all cursor-pointer",
                selected
                  ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30"
                  : "bg-secondary/30 border-border/60 hover:bg-secondary/70 hover:border-border",
              )}
            >
              <div
                className="size-3.5 shrink-0 rounded-full border border-white/10 shadow-xs flex items-center justify-center"
                style={{ backgroundColor: swatch.background }}
              >
                <div
                  className="size-1 rounded-full"
                  style={{ backgroundColor: swatch.accent }}
                />
              </div>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[11px] font-medium text-foreground truncate">
                  {theme.name}
                </span>
                {description ? (
                  <span className="line-clamp-1 text-[9.5px] text-muted-foreground">
                    {description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {variations.length > 0 && selectedTheme ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {variations.map((variation) => {
            const swatch = resolveThemeSwatch(
              selectedTheme,
              variation.id,
              resolvedMode,
            );
            const selected = themeVariation === variation.id;
            return (
              <button
                key={variation.id}
                type="button"
                title={variation.name}
                aria-label={variation.name}
                aria-pressed={selected}
                onClick={() => void setThemeVariation(variation.id)}
                className={cn(
                  "relative flex size-6 items-center justify-center rounded-full p-0.5 transition-all cursor-pointer",
                  selected
                    ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "opacity-75 hover:scale-105 hover:opacity-100",
                )}
              >
                <span
                  className="flex h-full w-full overflow-hidden rounded-full border border-border/60"
                  style={{ background: swatch.background }}
                >
                  <span className="h-full w-1/2" style={{ background: swatch.background }} />
                  <span className="h-full w-1/2" style={{ background: swatch.accent }} />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
