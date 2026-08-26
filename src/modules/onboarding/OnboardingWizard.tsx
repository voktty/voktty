import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CpuIcon,
  GlobeIcon,
  Key01Icon,
  Layout01Icon,
  PaintBoardIcon,
  SparklesIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "@/modules/i18n";
import {
  SUPPORTED_LANGUAGES,
  type LanguageId,
} from "@/modules/i18n/types";
import {
  setDefaultModel,
  setEditorFontSize,
  setHasCompletedOnboarding,
  setLanguage,
  setTabStyle,
  setTerminalFontSize,
  setThemeId,
  usePreferencesStore,
} from "@/modules/settings";
import { getKey, setKey } from "@/modules/ai/lib/keyring";
import { emitKeysChanged } from "@/modules/settings/store";
import { openExternalUrl } from "@/lib/external-link";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/modules/ai/config";

interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FEATURED_THEMES = [
  { id: "voktty-default", name: "Voktty Dark", bg: "#0d0f12", accent: "#6366f1" },
  { id: "tokyo-night", name: "Tokyo Night", bg: "#1a1b26", accent: "#7aa2f7" },
  { id: "catppuccin", name: "Catppuccin Mocha", bg: "#1e1e2e", accent: "#cba6f7" },
  { id: "nord", name: "Nord", bg: "#2e3440", accent: "#88c0d0" },
  { id: "everforest", name: "Everforest", bg: "#2d353b", accent: "#a7c080" },
  { id: "rose-pine", name: "Rosé Pine", bg: "#191724", accent: "#ebbcba" },
  { id: "dracula", name: "Dracula", bg: "#282a36", accent: "#bd93f9" },
  { id: "xcode", name: "Xcode Light", bg: "#ffffff", accent: "#007aff" },
];

const FONT_PRESETS = [
  { labelKey: "compact" as const, size: 12 },
  { labelKey: "standard" as const, size: 14 },
  { labelKey: "large" as const, size: 16 },
  { labelKey: "extra" as const, size: 18 },
];

const OTHER_PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic Claude" },
  { id: "google", name: "Google Gemini" },
  { id: "openrouter", name: "OpenRouter" },
];

export function OnboardingWizard({ open, onOpenChange }: OnboardingWizardProps) {
  const { t, language } = useTranslation();
  const prefs = usePreferencesStore();

  const [step, setStep] = useState<number>(1);
  const [deepseekKey, setDeepseekKey] = useState<string>("");
  const [showDeepseekKey, setShowDeepseekKey] = useState<boolean>(false);
  const [isDeepseekSaved, setIsDeepseekSaved] = useState<boolean>(false);
  const [activeOtherProvider, setActiveOtherProvider] = useState<ProviderId | null>(null);
  const [otherKey, setOtherKey] = useState<string>("");
  const [otherKeySaved, setOtherKeySaved] = useState<boolean>(false);

  // Load existing key if any
  useEffect(() => {
    if (open) {
      void getKey("deepseek").then((k) => {
        if (k) {
          setDeepseekKey(k);
          setIsDeepseekSaved(true);
        }
      });
    }
  }, [open]);

  const handleFinish = async () => {
    await setHasCompletedOnboarding(true);
    onOpenChange(false);
  };

  const handleLanguageSelect = (langId: LanguageId) => {
    void setLanguage(langId);
  };

  const handleSaveDeepseekKey = async () => {
    const trimmed = deepseekKey.trim();
    if (!trimmed) return;
    try {
      await setKey("deepseek", trimmed);
      await emitKeysChanged();
      await setDefaultModel("deepseek-v4-flash");
      setIsDeepseekSaved(true);
    } catch (e) {
      console.error("[voktty] failed to save deepseek key:", e);
    }
  };

  const handleSaveOtherKey = async (provider: ProviderId) => {
    const trimmed = otherKey.trim();
    if (!trimmed) return;
    try {
      await setKey(provider, trimmed);
      await emitKeysChanged();
      setOtherKeySaved(true);
    } catch (e) {
      console.error(`[voktty] failed to save ${provider} key:`, e);
    }
  };

  const steps = [
    { num: 1, title: t("onboarding.step1Title"), desc: t("onboarding.step1Desc"), icon: GlobeIcon },
    { num: 2, title: t("onboarding.step2Title"), desc: t("onboarding.step2Desc"), icon: PaintBoardIcon },
    { num: 3, title: t("onboarding.step3Title"), desc: t("onboarding.step3Desc"), icon: CpuIcon },
    { num: 4, title: t("onboarding.step4Title"), desc: t("onboarding.step4Desc"), icon: SparklesIcon },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[760px] max-w-[95vw] sm:max-w-[760px] md:max-w-[760px] lg:max-w-[760px] h-[470px] max-h-[88vh] overflow-hidden flex flex-row rounded-2xl bg-card/95 backdrop-blur-2xl border border-border/70 shadow-2xl p-0 gap-0 select-none"
      >
        {/* LEFT SIDEBAR / STEP RAIL */}
        <div className="w-52 shrink-0 bg-muted/15 border-r border-border/40 flex flex-col justify-between p-3.5">
          <div className="space-y-3.5">
            {/* Logo & Branding */}
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 shadow-xs">
                <img src="/voktty.svg" alt="Voktty" className="size-4.5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-heading font-bold text-sm tracking-tight text-foreground">
                    Voktty
                  </span>
                  <span className="rounded-full bg-primary/15 px-1.5 py-0.2 text-[9px] font-semibold text-primary border border-primary/25">
                    {t("onboarding.setupBadge")}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-1">
                  {t("onboarding.workspaceTitle")}
                </p>
              </div>
            </div>

            {/* Vertical Step Navigation */}
            <div className="space-y-1 pt-0.5">
              {steps.map((s) => {
                const isActive = step === s.num;
                const isCompleted = step > s.num;
                const StepIcon = s.icon;
                return (
                  <button
                    key={s.num}
                    type="button"
                    onClick={() => setStep(s.num)}
                    className={cn(
                      "w-full flex items-center gap-2 p-1.5 rounded-lg text-left transition-all cursor-pointer select-none",
                      isActive
                        ? "bg-primary/10 text-primary font-semibold shadow-xs ring-1 ring-primary/25"
                        : isCompleted
                          ? "text-foreground/90 hover:bg-muted/50"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md text-[10.5px] font-semibold transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : isCompleted
                            ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                            : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {isCompleted ? (
                        <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.5} />
                      ) : (
                        <HugeiconsIcon icon={StepIcon} size={11} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] truncate">{s.title}</div>
                      <div className="text-[9px] text-muted-foreground truncate opacity-70">
                        {t(`onboarding.stepRail${s.num}` as "onboarding.stepRail1")}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Security Note */}
          <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-border/30 text-[9.5px] text-muted-foreground">
            <HugeiconsIcon icon={Key01Icon} size={12} className="text-primary shrink-0" />
            <span className="leading-tight">{t("onboarding.keySavedNotice")}</span>
          </div>
        </div>

        {/* RIGHT MAIN CONTENT AREA */}
        <div className="flex-1 flex flex-col min-w-0 h-full bg-background/40">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/30 bg-muted/10">
            <div>
              <span className="text-[9.5px] font-semibold text-primary uppercase tracking-wider">
                {t("onboarding.stepLabel", { step })}
              </span>
              <h2 className="text-xs font-semibold text-foreground">
                {steps[step - 1]?.title}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFinish}
              className="text-[11px] text-muted-foreground hover:text-foreground h-6 px-2 rounded-md cursor-pointer"
            >
              {t("onboarding.skip")}
            </Button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto px-5 py-3.5 space-y-3.5">
            {/* STEP 1: Language & Tabs */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("onboarding.step1Desc")}
                  </p>
                </div>

                {/* Language Grid */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-foreground/80">
                    {t("onboarding.summaryLanguage")}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                    {SUPPORTED_LANGUAGES.map((lang) => {
                      const selected = (language ?? prefs.language) === lang.id;
                      return (
                        <button
                          key={lang.id}
                          type="button"
                          onClick={() => handleLanguageSelect(lang.id)}
                          className={cn(
                            "flex flex-col items-center justify-center p-1.5 rounded-lg border text-[11px] font-medium transition-all text-center gap-0.5 cursor-pointer",
                            selected
                              ? "bg-primary/15 border-primary text-primary shadow-xs ring-1 ring-primary/30"
                              : "bg-secondary/30 border-border/60 text-foreground hover:bg-secondary/70 hover:border-border"
                          )}
                        >
                          <span className="font-semibold text-[11px]">{lang.label}</span>
                          <span className="text-[9px] opacity-60 uppercase tracking-wider">{lang.id}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Tab Layout */}
                <div className="space-y-1.5 pt-0.5">
                  <label className="text-[11px] font-medium text-foreground/80">
                    {t("onboarding.tabLayout")}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Vertical (Sidebar) */}
                    <button
                      type="button"
                      onClick={() => void setTabStyle("vertical")}
                      className={cn(
                        "flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                        prefs.tabStyle === "vertical"
                          ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30"
                          : "bg-secondary/30 border-border/60 hover:bg-secondary/60 hover:border-border"
                      )}
                    >
                      <div className="p-1.5 rounded-lg bg-background/80 border border-border/40 text-primary shrink-0">
                        <HugeiconsIcon icon={Layout01Icon} size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11.5px] font-semibold text-foreground">
                            {t("onboarding.tabVertical")}
                          </span>
                          <span className="text-[8.5px] bg-primary/20 text-primary font-medium px-1 py-0.1 rounded">
                            {t("onboarding.recommended")}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                          {t("onboarding.tabVerticalDesc")}
                        </p>
                      </div>
                    </button>

                    {/* Horizontal (Top Bar) */}
                    <button
                      type="button"
                      onClick={() => void setTabStyle("horizontal")}
                      className={cn(
                        "flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                        prefs.tabStyle === "horizontal"
                          ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30"
                          : "bg-secondary/30 border-border/60 hover:bg-secondary/60 hover:border-border"
                      )}
                    >
                      <div className="p-1.5 rounded-lg bg-background/80 border border-border/40 text-muted-foreground shrink-0">
                        <HugeiconsIcon icon={ViewIcon} size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[11.5px] font-semibold text-foreground">
                          {t("onboarding.tabHorizontal")}
                        </span>
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                          {t("onboarding.tabHorizontalDesc")}
                        </p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Theme & Typography */}
            {step === 2 && (
              <div className="space-y-3.5">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("onboarding.step2Desc")}
                  </p>
                </div>

                {/* Theme Grid */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-foreground/80">
                    {t("onboarding.themeLabel")}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {FEATURED_THEMES.map((th) => {
                      const selected = prefs.themeId === th.id;
                      return (
                        <button
                          key={th.id}
                          type="button"
                          onClick={() => void setThemeId(th.id)}
                          className={cn(
                            "flex items-center gap-2 p-1.5 rounded-lg border text-left transition-all cursor-pointer",
                            selected
                              ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30"
                              : "bg-secondary/30 border-border/60 hover:bg-secondary/70 hover:border-border"
                          )}
                        >
                          <div
                            className="size-3.5 rounded-full border border-white/10 shrink-0 shadow-xs flex items-center justify-center"
                            style={{ backgroundColor: th.bg }}
                          >
                            <div
                              className="size-1 rounded-full"
                              style={{ backgroundColor: th.accent }}
                            />
                          </div>
                          <span className="text-[11px] font-medium text-foreground truncate">
                            {th.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Font Size Presets */}
                <div className="space-y-1.5 pt-0.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-foreground/80">
                      {t("onboarding.terminalFontSize")}
                    </label>
                    <span className="text-[11px] font-mono font-semibold text-primary">
                      {prefs.terminalFontSize}px
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {FONT_PRESETS.map((p) => {
                      const selected = prefs.terminalFontSize === p.size;
                      return (
                        <button
                          key={p.size}
                          type="button"
                          onClick={() => {
                            void setTerminalFontSize(p.size);
                            void setEditorFontSize(p.size - 1);
                          }}
                          className={cn(
                            "flex flex-col items-center justify-center py-1.5 px-2.5 rounded-lg border text-[11px] font-medium transition-all cursor-pointer",
                            selected
                              ? "bg-primary/10 border-primary text-primary shadow-xs ring-1 ring-primary/30"
                              : "bg-secondary/30 border-border/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                          )}
                        >
                          <span>{t(`onboarding.${p.labelKey}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Preview Box */}
                <div className="rounded-xl border border-border/60 bg-black/40 p-2.5 font-mono text-foreground/90 space-y-0.5 shadow-inner">
                  <div className="flex items-center justify-between text-[9.5px] text-muted-foreground pb-0.5 border-b border-border/20">
                    <span>{t("onboarding.terminalPreview")}</span>
                    <span>utf-8</span>
                  </div>
                  <div style={{ fontSize: `${prefs.terminalFontSize}px` }} className="leading-snug">
                    <p className="text-emerald-400">$ voktty --ready</p>
                    <p className="text-muted-foreground">{t("onboarding.environmentReady")}</p>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: AI & DeepSeek */}
            {step === 3 && (
              <div className="space-y-3.5">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("onboarding.step3Desc")}
                  </p>
                </div>

                {/* DeepSeek Hero Card */}
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2 shadow-xs">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded-md bg-primary/20 text-primary font-bold text-[10px]">
                        DS
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11.5px] font-semibold text-foreground">
                            {t("onboarding.deepseekTitle")}
                          </span>
                          <span className="text-[8.5px] bg-emerald-500/15 text-emerald-500 font-medium px-1 py-0.1 rounded">
                            {t("onboarding.recommended")}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {t("onboarding.deepseekDescription")}
                        </p>
                      </div>
                    </div>
                    {isDeepseekSaved && (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium bg-emerald-500/10 px-1.5 py-0.2 rounded-full">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
                        {t("onboarding.aiConnected")}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="relative">
                      <Input
                        type={showDeepseekKey ? "text" : "password"}
                        value={deepseekKey}
                        onChange={(e) => {
                          setDeepseekKey(e.target.value);
                          setIsDeepseekSaved(false);
                        }}
                        placeholder="sk-..."
                        className="h-7 font-mono text-[11px] pr-20 bg-background/80 border-border/60 focus:border-primary"
                      />
                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                          className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                          title={showDeepseekKey ? t("onboarding.hideKey") : t("onboarding.showKey")}
                        >
                          <HugeiconsIcon
                            icon={showDeepseekKey ? ViewOffIcon : ViewIcon}
                            size={13}
                          />
                        </button>
                        <Button
                          size="sm"
                          onClick={handleSaveDeepseekKey}
                          disabled={!deepseekKey.trim() || isDeepseekSaved}
                          className="h-5 text-[10px] px-2 rounded cursor-pointer"
                        >
                          {isDeepseekSaved ? t("onboarding.saved") : t("onboarding.save")}
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] pt-0.5">
                      <button
                        type="button"
                        onClick={() => void openExternalUrl("https://platform.deepseek.com/api_keys")}
                        className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {t("onboarding.getDeepseekKey")}
                        <HugeiconsIcon icon={ArrowRight01Icon} size={10} />
                      </button>
                      <span className="text-muted-foreground text-[9.5px]">
                        {t("onboarding.defaultModel", { model: "deepseek-v4-flash" })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Other Providers Drawer */}
                <div className="space-y-1.5 pt-0.5">
                  <label className="text-[11px] font-medium text-foreground/80">
                    {t("onboarding.otherProviders")}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {OTHER_PROVIDERS.map((prov) => (
                      <button
                        key={prov.id}
                        type="button"
                        onClick={() => {
                          setActiveOtherProvider(prov.id);
                          setOtherKey("");
                          setOtherKeySaved(false);
                          void getKey(prov.id).then((k) => {
                            if (k) {
                              setOtherKey(k);
                              setOtherKeySaved(true);
                            }
                          });
                        }}
                        className={cn(
                          "flex items-center justify-between p-1.5 rounded-lg border text-[11px] font-medium transition-all cursor-pointer",
                          activeOtherProvider === prov.id
                            ? "bg-secondary/80 border-primary/50 text-foreground"
                            : "bg-secondary/30 border-border/50 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                        )}
                      >
                        <span className="truncate">{prov.name}</span>
                        <HugeiconsIcon icon={Key01Icon} size={11} className="opacity-60" />
                      </button>
                    ))}
                  </div>

                  {activeOtherProvider && (
                    <div className="p-2.5 rounded-xl bg-secondary/30 border border-border/60 space-y-1.5 mt-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-foreground">
                          {t("onboarding.providerApiKey", { provider: OTHER_PROVIDERS.find((p) => p.id === activeOtherProvider)?.name ?? "" })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveOtherProvider(null)}
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={12} />
                        </button>
                      </div>
                      <div className="flex gap-1.5">
                        <Input
                          type="password"
                          value={otherKey}
                          onChange={(e) => {
                            setOtherKey(e.target.value);
                            setOtherKeySaved(false);
                          }}
                          placeholder={t("onboarding.apiKeyPlaceholder")}
                          className="h-7 font-mono text-[11px] bg-background/80 flex-1"
                        />
                        <Button
                          size="sm"
                          onClick={() => void handleSaveOtherKey(activeOtherProvider)}
                          disabled={!otherKey.trim() || otherKeySaved}
                          className="h-7 text-[11px] cursor-pointer"
                        >
                          {otherKeySaved ? t("onboarding.saved") : t("onboarding.save")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 4: Ready & Summary */}
            {step === 4 && (
              <div className="space-y-3.5">
                <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-500">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">
                      {t("onboarding.step4Title")}
                    </h3>
                    <p className="text-[10px] text-muted-foreground">
                      {t("onboarding.step4Desc")}
                    </p>
                  </div>
                </div>

                {/* Summary Cards Grid */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-secondary/35 border border-border/60">
                    <span className="text-muted-foreground text-[9.5px] uppercase font-semibold">
                      {t("onboarding.summaryLanguage")}
                    </span>
                    <p className="font-medium text-foreground mt-0.5">
                      {SUPPORTED_LANGUAGES.find((l) => l.id === (language ?? prefs.language))?.label || prefs.language}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-secondary/35 border border-border/60">
                    <span className="text-muted-foreground text-[9.5px] uppercase font-semibold">
                      {t("onboarding.summaryTabs")}
                    </span>
                    <p className="font-medium text-foreground mt-0.5 capitalize">
                      {prefs.tabStyle}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-secondary/35 border border-border/60">
                    <span className="text-muted-foreground text-[9.5px] uppercase font-semibold">
                      {t("onboarding.summaryTheme")}
                    </span>
                    <p className="font-medium text-foreground mt-0.5 truncate">
                      {FEATURED_THEMES.find((th) => th.id === prefs.themeId)?.name || prefs.themeId}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-secondary/35 border border-border/60">
                    <span className="text-muted-foreground text-[9.5px] uppercase font-semibold">
                      {t("onboarding.summaryFontSize")}
                    </span>
                    <p className="font-medium text-foreground mt-0.5">
                      {prefs.terminalFontSize}px (Terminal)
                    </p>
                  </div>
                </div>

                {/* Shortcuts Cheat Sheet */}
                <div className="rounded-xl border border-border/50 bg-muted/20 p-2.5 space-y-1.5">
                  <span className="text-[10.5px] font-semibold text-foreground/80">
                    {t("onboarding.shortcutsTitle")}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                    <div className="flex flex-col items-center p-1.5 rounded-md bg-background/50 border border-border/30 text-center">
                      <kbd className="font-mono text-[9px] bg-muted px-1 py-0.2 rounded border border-border">Ctrl + I</kbd>
                      <span className="text-muted-foreground mt-0.5 text-[9.5px]">{t("onboarding.shortcutChat")}</span>
                    </div>
                    <div className="flex flex-col items-center p-1.5 rounded-md bg-background/50 border border-border/30 text-center">
                      <kbd className="font-mono text-[9px] bg-muted px-1 py-0.2 rounded border border-border">Ctrl + T</kbd>
                      <span className="text-muted-foreground mt-0.5 text-[9.5px]">{t("onboarding.shortcutNewTab")}</span>
                    </div>
                    <div className="flex flex-col items-center p-1.5 rounded-md bg-background/50 border border-border/30 text-center">
                      <kbd className="font-mono text-[9px] bg-muted px-1 py-0.2 rounded border border-border">Ctrl + Shift + P</kbd>
                      <span className="text-muted-foreground mt-0.5 text-[9.5px]">{t("onboarding.shortcutCommands")}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Navigation */}
          <div className="flex items-center justify-between border-t border-border/30 px-5 py-2.5 bg-muted/15">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep((prev) => Math.max(1, prev - 1))}
              disabled={step === 1}
              className="text-[11px] h-7 px-3 rounded-lg gap-1.5 cursor-pointer"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
              {t("onboarding.back")}
            </Button>

            {step < 4 ? (
              <Button
                size="sm"
                onClick={() => setStep((prev) => Math.min(4, prev + 1))}
                className="text-[11px] h-7 px-4 rounded-lg gap-1.5 font-medium shadow-xs cursor-pointer"
              >
                {t("onboarding.next")}
                <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleFinish}
                className="text-[11px] h-7 px-4.5 rounded-lg gap-1.5 font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer"
              >
                {t("onboarding.finish")}
                <HugeiconsIcon icon={SparklesIcon} size={12} />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
