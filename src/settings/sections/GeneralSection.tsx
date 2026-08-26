import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type OsNotificationResult,
  testAgentOsNotification,
} from "@/modules/agents/lib/notify";
import { playVokttySound, unlockVokttySounds } from "@/modules/sound";
import {
  SUPPORTED_LANGUAGES,
  type LanguageId,
  useTranslation,
} from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type {
  AgentAvatarAnimationIntensity,
  AgentAvatarSize,
  SpaceViewLimit,
  TabStyle,
  ThemePref,
} from "@/modules/settings/store";
import {
  setAgentAvatarAnimationIntensity,
  setAgentAvatarReducedMotion,
  setAgentAvatarSize,
  setAgentNotificationSound,
  setAgentAvatarEnabled,
  setAgentNotifications,
  setAutostart,
  setConfirmCloseRunningTerminal,
  setDefaultWorkspaceEnv,
  setSpaceViewLimit,
  setExplorerGitDecorations,
  setRestoreWindowState,
  setSoundEnabled,
  setSoundVolume,
  setShowHidden,
  setTabStyle,
  setTerminalCursorBlink,
  setTerminalCursorStyle,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalFontWeight,
  setTerminalLetterSpacing,
  setTerminalScrollback,
  setTerminalShell,
  setTerminalWebglEnabled,
  setZoomLevel,
  TAB_STYLES,
  SPACE_VIEW_LIMITS,
  TERMINAL_FONT_SIZES,
  TERMINAL_SCROLLBACK_PRESETS,
} from "@/modules/settings/store";
import {
  downloadConfiguration,
  exportConfiguration,
  importConfiguration,
} from "@/modules/settings/configExport";
import { useTheme } from "@/modules/theme";
import {
  ComputerIcon,
  Copy01Icon,
  Download01Icon,
  Moon02Icon,
  SparklesIcon,
  Sun03Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const APPEARANCE: {
  id: ThemePref;
  icon: typeof ComputerIcon;
}[] = [
  { id: "system", icon: ComputerIcon },
  { id: "light", icon: Sun03Icon },
  { id: "dark", icon: Moon02Icon },
];

const TERMINAL_FONT_WEIGHTS = [
  { value: "normal" },
  { value: "500" },
  { value: "600" },
  { value: "bold" },
] as const;
const TERMINAL_CURSOR_STYLES = [
  { value: "bar" },
  { value: "block" },
  { value: "underline" },
] as const;
const LETTER_SPACINGS = [-4, -3, -2, -1, 0, 1, 2, 3, 4] as const;
const AVATAR_SIZE_VALUES: readonly AgentAvatarSize[] = [
  "compact",
  "standard",
  "large",
];
const AVATAR_INTENSITY_VALUES: readonly AgentAvatarAnimationIntensity[] = [
  "low",
  "standard",
  "high",
];

type ShellInfo = { name: string; path: string; integrated: boolean };
const SHELL_AUTO = "auto";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.05;
const NOTIFICATION_TEST_DELAY_MS = 2_000;

type NotificationTestState =
  | OsNotificationResult
  | "idle"
  | "waiting"
  | "sending";

export function GeneralSection() {
  const { mode, setMode } = useTheme();
  const { t, language, setLanguage } = useTranslation();

  const autostart = usePreferencesStore((s) => s.autostart);
  const restoreWindowState = usePreferencesStore((s) => s.restoreWindowState);
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );
  const terminalWebglEnabled = usePreferencesStore(
    (s) => s.terminalWebglEnabled,
  );
  const terminalCursorBlink = usePreferencesStore((s) => s.terminalCursorBlink);
  const terminalCursorStyle = usePreferencesStore((s) => s.terminalCursorStyle);
  const terminalFontFamily = usePreferencesStore((s) => s.terminalFontFamily);
  const terminalFontWeight = usePreferencesStore((s) => s.terminalFontWeight);
  const terminalShell = usePreferencesStore((s) => s.terminalShell);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [wslDistros, setWslDistros] = useState<{ name: string }[]>([]);
  const defaultWorkspaceEnv = usePreferencesStore((s) => s.defaultWorkspaceEnv);
  const spaceViewLimit = usePreferencesStore((s) => s.spaceViewLimit);
  const terminalLetterSpacing = usePreferencesStore(
    (s) => s.terminalLetterSpacing,
  );
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);
  const terminalScrollback = usePreferencesStore((s) => s.terminalScrollback);
  const confirmCloseRunningTerminal = usePreferencesStore(
    (s) => s.confirmCloseRunningTerminal,
  );
  const tabStyle = usePreferencesStore((s) => s.tabStyle);
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);
  const soundEnabled = usePreferencesStore((s) => s.soundEnabled);
  const soundVolume = usePreferencesStore((s) => s.soundVolume);
  const agentAvatarEnabled = usePreferencesStore((s) => s.agentAvatarEnabled);
  const agentAvatarSize = usePreferencesStore((s) => s.agentAvatarSize);
  const agentAvatarAnimationIntensity = usePreferencesStore(
    (s) => s.agentAvatarAnimationIntensity,
  );
  const agentAvatarReducedMotion = usePreferencesStore(
    (s) => s.agentAvatarReducedMotion,
  );
  const agentNotifications = usePreferencesStore((s) => s.agentNotifications);
  const agentNotificationSound = usePreferencesStore(
    (s) => s.agentNotificationSound,
  );
  const [notificationTest, setNotificationTest] =
    useState<NotificationTestState>("idle");
  const notificationTestPending =
    notificationTest === "waiting" || notificationTest === "sending";

  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportConfig = () => {
    try {
      downloadConfiguration();
      toast.success(t("settings.general.backup.exportSuccess"));
    } catch {
      toast.error(t("settings.general.backup.exportFailed"));
    }
  };

  const handleCopyConfigJson = async () => {
    try {
      const cfg = exportConfiguration();
      await navigator.clipboard.writeText(JSON.stringify(cfg, null, 2));
      toast.success(t("settings.general.backup.copiedJson"));
    } catch {
      toast.error(t("settings.general.backup.copyJsonFailed"));
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const res = await importConfiguration(text);
      if (res.success) {
        toast.success(
          t("settings.general.backup.importSuccess", {
            prefs: res.importedPreferencesCount,
            ssh: res.importedSshCount,
          }),
        );
      } else {
        toast.error(res.error || t("settings.general.backup.importInvalid"));
      }
    } catch (err) {
      toast.error(
        t("settings.general.backup.importError", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const testNotification = async () => {
    setNotificationTest("waiting");
    await new Promise((resolve) =>
      setTimeout(resolve, NOTIFICATION_TEST_DELAY_MS),
    );
    setNotificationTest("sending");
    setNotificationTest(await testAgentOsNotification(agentNotificationSound));
  };

  const testInterfaceSound = () => {
    void unlockVokttySounds().then(() => {
      playVokttySound("select");
    });
  };

  useEffect(() => {
    let alive = true;
    void isEnabled()
      .then((on) => {
        if (!alive) return;
        if (on !== usePreferencesStore.getState().autostart) {
          void setAutostart(on);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void invoke<ShellInfo[]>("pty_list_shells")
      .then(setShells)
      .catch(() => {});
    void invoke<{ name: string }[]>("wsl_list_distros")
      .then(setWslDistros)
      .catch(() => {});
  }, []);

  const onToggleAutostart = async (next: boolean) => {
    try {
      if (next) await enable();
      else await disable();
      await setAutostart(next);
    } catch (e) {
      console.error("autostart toggle failed", e);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t("settings.general.title")}
        description={t("settings.general.description")}
      />

      <div className="flex items-center justify-between rounded-lg border border-primary/25 bg-primary/5 p-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <HugeiconsIcon icon={SparklesIcon} size={14} />
          </div>
          <div>
            <span className="text-[11.5px] font-semibold text-foreground">
              {t("onboarding.title")}
            </span>
            <p className="text-[10px] text-muted-foreground">
              {t("onboarding.subtitle")}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void emit("voktty://open-onboarding");
            window.dispatchEvent(new CustomEvent("voktty:open-onboarding"));
          }}
          className="h-6.5 text-[11px] px-2.5 gap-1.5 cursor-pointer shrink-0 rounded-md"
        >
          <HugeiconsIcon icon={SparklesIcon} size={11} />
          {t("onboarding.step1Title")}...
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.appearance.title")}
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {APPEARANCE.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn(
                "group flex h-13 flex-col items-center justify-center gap-1 rounded-md border bg-card/60 transition-all cursor-pointer",
                mode === o.id
                  ? "border-primary/60 bg-accent/50 ring-1 ring-primary/30 text-foreground font-medium"
                  : "border-border/50 hover:border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={o.icon} size={15} strokeWidth={1.5} />
              <span className="text-[10.5px]">{t(`settings.general.appearance.${o.id}`)}</span>
            </button>
          ))}
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          {t("settings.general.appearance.themesHint")}{" "}
          <strong className="font-medium text-foreground">{t("settings.general.appearance.themesTab")}</strong>.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.language.title")}
        </span>
        <SettingRow
          title={t("settings.general.language.title")}
          description={t("settings.general.language.description")}
        >
          <Select
            value={language}
            onValueChange={(v) => void setLanguage(v as LanguageId)}
          >
            <SelectTrigger className="h-7 w-40 text-[11.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <SelectItem
                  key={lang.id}
                  value={lang.id}
                  className="text-[11.5px]"
                >
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.zoom.title")}
        </span>
        <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {t("settings.general.zoom.label")}
            </span>
            <span className="tabular-nums text-[10.5px] text-muted-foreground font-mono">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>
          <Slider
            value={[zoomLevel]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            onValueChange={(v) => void setZoomLevel(v[0] ?? 1)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.tabs.title")}
        </span>
        <SettingRow
          title={t("settings.general.tabs.layoutTitle")}
          description={t("settings.general.tabs.layoutDesc")}
        >
          <Select
            value={tabStyle}
            onValueChange={(v) => void setTabStyle(v as TabStyle)}
          >
            <SelectTrigger className="h-7 w-36 text-[11.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAB_STYLES.map((s) => (
                <SelectItem key={s} value={s} className="text-[11.5px]">
                  {s === "horizontal"
                    ? t("settings.general.tabs.layoutHorizontal")
                    : t("settings.general.tabs.layoutVertical")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.explorer.title")}
        </span>
        <SettingRow
          title={t("settings.general.explorer.showHiddenTitle")}
          description={t("settings.general.explorer.showHiddenDesc")}
        >
          <Switch
            checked={showHidden}
            onCheckedChange={(v) => void setShowHidden(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.explorer.gitDecorationsTitle")}
          description={t("settings.general.explorer.gitDecorationsDesc")}
        >
          <Switch
            checked={explorerGitDecorations}
            onCheckedChange={(v) => void setExplorerGitDecorations(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.terminal.title")}
        </span>
        <SettingRow
          title={
            <span className="inline-flex items-center gap-1.5">
              {t("settings.general.terminal.webglTitle")}
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="cursor-help text-[11px] text-muted-foreground/70 leading-none"
                      aria-label={t("settings.general.terminal.webglTitle")}
                    >
                      ⓘ
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-65 text-[11px]">
                    {t("settings.general.terminal.webglDesc")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          }
          description={t("settings.general.terminal.webglDesc")}
        >
          <Switch
            checked={terminalWebglEnabled}
            onCheckedChange={(v) => void setTerminalWebglEnabled(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.terminal.cursorBlinkTitle")}
          description={t("settings.general.terminal.cursorBlinkDesc")}
        >
          <Switch
            checked={terminalCursorBlink}
            onCheckedChange={(v) => void setTerminalCursorBlink(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.terminal.cursorStyleTitle")}
          description={t("settings.general.terminal.cursorStyleDesc")}
        >
          <Select
            value={terminalCursorStyle}
            onValueChange={(v) => void setTerminalCursorStyle(v)}
          >
            <SelectTrigger
              value={terminalCursorStyle}
              className="h-8 w-28 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_CURSOR_STYLES.map((style) => (
                <SelectItem
                  key={style.value}
                  value={style.value}
                  className="text-[12px]"
                >
                  {style.value === "bar"
                    ? t("settings.general.terminal.cursorBar")
                    : style.value === "block"
                      ? t("settings.general.terminal.cursorBlock")
                      : t("settings.general.terminal.cursorUnderline")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <FontFamilyInput
          value={terminalFontFamily}
          onCommit={(v) => void setTerminalFontFamily(v)}
        />
        <SettingRow
          title={t("settings.general.terminal.fontWeightTitle")}
          description={t("settings.general.terminal.fontWeightDesc")}
        >
          <Select
            value={terminalFontWeight}
            onValueChange={(v) => void setTerminalFontWeight(v)}
          >
            <SelectTrigger
              value={terminalFontWeight}
              className="h-8 w-28 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_FONT_WEIGHTS.map((w) => (
                <SelectItem
                  key={w.value}
                  value={w.value}
                  className="text-[12px]"
                >
                  {w.value === "normal"
                    ? t("settings.general.terminal.fontWeightNormal")
                    : w.value === "500"
                      ? t("settings.general.terminal.fontWeightMedium")
                      : w.value === "600"
                        ? t("settings.general.terminal.fontWeightSemiBold")
                        : t("settings.general.terminal.fontWeightBold")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settings.general.terminal.shellTitle")}
          description={t("settings.general.terminal.shellDesc")}
        >
          <Select
            value={terminalShell || SHELL_AUTO}
            onValueChange={(v) =>
              void setTerminalShell(v === SHELL_AUTO ? "" : v)
            }
          >
            <SelectTrigger
              value={terminalShell || SHELL_AUTO}
              className="h-8 w-40 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SHELL_AUTO} className="text-[12px]">
                {t("settings.general.terminal.shellAuto")}
              </SelectItem>
              {shells.map((s) => (
                <SelectItem key={s.path} value={s.path} className="text-[12px]">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {(wslDistros.length > 0 || defaultWorkspaceEnv !== "local") && (
          <SettingRow
            title={t("settings.general.window.defaultEnvTitle")}
            description={t("settings.general.window.defaultEnvDesc")}
          >
            <Select
              value={defaultWorkspaceEnv}
              onValueChange={(v) => void setDefaultWorkspaceEnv(v)}
            >
              <SelectTrigger
                value={defaultWorkspaceEnv}
                className="h-8 w-40 text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local" className="text-[12px]">
                  Windows
                </SelectItem>
                {wslDistros.map((d) => (
                  <SelectItem
                    key={d.name}
                    value={`wsl:${d.name}`}
                    className="text-[12px]"
                  >
                    WSL: {d.name}
                  </SelectItem>
                ))}
                {defaultWorkspaceEnv.startsWith("wsl:") &&
                  !wslDistros.some(
                    (d) => `wsl:${d.name}` === defaultWorkspaceEnv,
                  ) && (
                    <SelectItem
                      value={defaultWorkspaceEnv}
                      className="text-[12px]"
                    >
                      {defaultWorkspaceEnv.slice("wsl:".length)} ({t("workspace.wslUnavailable")})
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
          </SettingRow>
        )}
        <SettingRow
          title={t("settings.general.window.spaceViewLimitTitle")}
          description={t("settings.general.window.spaceViewLimitDesc")}
        >
          <Select
            value={String(spaceViewLimit)}
            onValueChange={(value) =>
              void setSpaceViewLimit(Number(value) as SpaceViewLimit)
            }
          >
            <SelectTrigger className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPACE_VIEW_LIMITS.map((limit) => (
                <SelectItem key={limit} value={String(limit)} className="text-[12px]">
                  {limit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settings.general.terminal.letterSpacingTitle")}
          description={t("settings.general.terminal.letterSpacingDesc")}
        >
          <Select
            value={String(terminalLetterSpacing)}
            onValueChange={(v) => void setTerminalLetterSpacing(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LETTER_SPACINGS.map((v) => (
                <SelectItem key={v} value={String(v)} className="text-[12px]">
                  {v > 0 ? `+${v}` : v} px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title={t("settings.general.terminal.fontSizeTitle")} description={t("settings.general.terminal.fontSizeDesc")}>
          <Select
            value={String(terminalFontSize)}
            onValueChange={(v) => void setTerminalFontSize(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_FONT_SIZES.map((size) => (
                <SelectItem
                  key={size}
                  value={String(size)}
                  className="text-[12px]"
                >
                  {size} px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settings.general.terminal.scrollbackTitle")}
          description={t("settings.general.terminal.scrollbackDesc")}
        >
          <Select
            value={String(terminalScrollback)}
            onValueChange={(v) => void setTerminalScrollback(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-36 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_SCROLLBACK_PRESETS.map((lines) => (
                <SelectItem
                  key={lines}
                  value={String(lines)}
                  className="text-[12px]"
                >
                  {lines.toLocaleString()} {t("settings.general.terminal.scrollbackLinesUnit")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settings.general.terminal.confirmCloseTitle")}
          description={t("settings.general.terminal.confirmCloseDesc")}
        >
          <Switch
            checked={confirmCloseRunningTerminal}
            onCheckedChange={(v) => void setConfirmCloseRunningTerminal(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.notifications.soundsLabel")}
        </span>
        <SettingRow
          title={t("settings.general.notifications.soundEnabledTitle")}
          description={t("settings.general.notifications.soundEnabledDesc")}
        >
          <Switch
            checked={soundEnabled}
            onCheckedChange={(v) => void setSoundEnabled(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.notifications.soundVolumeTitle")}
          description={t("settings.general.notifications.soundVolumeDesc")}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Slider
              aria-label={t("settings.general.notifications.soundVolumeAria")}
              className="h-5 w-24 shrink-0 [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-track]]:h-1"
              value={[soundVolume]}
              min={0}
              max={1}
              step={0.05}
              disabled={!soundEnabled}
              onValueChange={(v) => {
                const next = v[0];
                if (next !== undefined) void setSoundVolume(next);
              }}
            />
            <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
              {Math.round(soundVolume * 100)}%
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="shrink-0"
              disabled={!soundEnabled}
              title={t("settings.general.notifications.testSoundButton")}
              onClick={testInterfaceSound}
            >
              {t("settings.general.notifications.testSoundButton")}
            </Button>
          </div>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.notifications.agentsLabel")}
        </span>
        <SettingRow
          title={t("settings.general.notifications.agentAvatarTitle")}
          description={t("settings.general.notifications.agentAvatarDesc")}
        >
          <Switch
            checked={agentAvatarEnabled}
            onCheckedChange={(v) => void setAgentAvatarEnabled(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.notifications.agentAvatarSizeTitle")}
          description={t("settings.general.notifications.agentAvatarSizeDesc")}
        >
          <Select
            value={agentAvatarSize}
            onValueChange={(value) => {
              if (AVATAR_SIZE_VALUES.includes(value as AgentAvatarSize)) {
                void setAgentAvatarSize(value as AgentAvatarSize);
              }
            }}
            disabled={!agentAvatarEnabled}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("settings.general.notifications.agentAvatarSizeTitle")}
              className="min-w-28 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVATAR_SIZE_VALUES.map((value) => (
                <SelectItem key={value} value={value} className="text-[12px]">
                  {t(`settings.general.notifications.agentAvatarSize.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settings.general.notifications.agentAvatarIntensityTitle")}
          description={t(
            "settings.general.notifications.agentAvatarIntensityDesc",
          )}
        >
          <Select
            value={agentAvatarAnimationIntensity}
            onValueChange={(value) => {
              if (
                AVATAR_INTENSITY_VALUES.includes(
                  value as AgentAvatarAnimationIntensity,
                )
              ) {
                void setAgentAvatarAnimationIntensity(
                  value as AgentAvatarAnimationIntensity,
                );
              }
            }}
            disabled={!agentAvatarEnabled}
          >
            <SelectTrigger
              size="sm"
              aria-label={t(
                "settings.general.notifications.agentAvatarIntensityTitle",
              )}
              className="min-w-28 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVATAR_INTENSITY_VALUES.map((value) => (
                <SelectItem key={value} value={value} className="text-[12px]">
                  {t(
                    `settings.general.notifications.agentAvatarIntensity.${value}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title={t("settings.general.notifications.agentAvatarReducedMotionTitle")}
          description={t(
            "settings.general.notifications.agentAvatarReducedMotionDesc",
          )}
        >
          <Switch
            checked={agentAvatarReducedMotion}
            disabled={!agentAvatarEnabled}
            aria-label={t(
              "settings.general.notifications.agentAvatarReducedMotionTitle",
            )}
            onCheckedChange={(value) => void setAgentAvatarReducedMotion(value)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.notifications.agentNotificationsTitle")}
          description={t("settings.general.notifications.agentNotificationsDesc")}
        >
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!agentNotifications || notificationTestPending}
              title={notificationTestTitle(notificationTest, t)}
              onClick={() => void testNotification()}
            >
              {notificationTestLabel(notificationTest, t)}
            </Button>
            <Switch
              checked={agentNotifications}
              disabled={notificationTestPending}
              onCheckedChange={(v) => {
                setNotificationTest("idle");
                void setAgentNotifications(v);
              }}
            />
          </div>
        </SettingRow>
        <SettingRow
          title={t("settings.general.notifications.soundTitle")}
          description={t("settings.general.notifications.soundDesc")}
        >
          <Switch
            checked={agentNotificationSound}
            disabled={!agentNotifications || notificationTestPending}
            onCheckedChange={(v) => void setAgentNotificationSound(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.window.startupLabel")}
        </span>
        <div className="flex flex-col gap-1.5">
          <SettingRow
            title={t("settings.general.window.autostartTitle")}
            description={t("settings.general.window.autostartDesc")}
          >
            <Switch
              checked={autostart}
              onCheckedChange={(v) => void onToggleAutostart(v)}
            />
          </SettingRow>
          <SettingRow
            title={t("settings.general.window.restoreStateTitle")}
            description={t("settings.general.window.restoreStateDesc")}
          >
            <Switch
              checked={restoreWindowState}
              onCheckedChange={(v) => void setRestoreWindowState(v)}
            />
          </SettingRow>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("settings.general.backup.title")}
        </span>
        <div className="flex flex-col gap-2">
          <SettingRow
            title={t("settings.general.backup.exportTitle")}
            description={t("settings.general.backup.exportDesc")}
          >
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyConfigJson}
                className="cursor-pointer gap-1.5 text-xs"
                title={t("settings.general.backup.copyJson")}
              >
                <HugeiconsIcon icon={Copy01Icon} size={14} />
                <span>{t("settings.general.backup.copyJson")}</span>
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleExportConfig}
                className="cursor-pointer gap-1.5 text-xs"
              >
                <HugeiconsIcon icon={Download01Icon} size={14} />
                <span>{t("settings.general.backup.exportButton")}</span>
              </Button>
            </div>
          </SettingRow>
          <SettingRow
            title={t("settings.general.backup.importTitle")}
            description={t("settings.general.backup.importDesc")}
          >
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileSelected}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer gap-1.5 text-xs"
              >
                <HugeiconsIcon icon={Upload01Icon} size={14} />
                <span>{isImporting ? t("settings.general.notifications.sending") : t("settings.general.backup.importButton")}</span>
              </Button>
            </div>
          </SettingRow>
        </div>
      </div>
    </div>
  );
}

function notificationTestLabel(status: NotificationTestState, t: (key: string) => string): string {
  switch (status) {
    case "waiting":
      return t("settings.general.notifications.switchApps");
    case "sending":
      return t("settings.general.notifications.sending");
    case "requested":
      return t("settings.general.notifications.requested");
    case "denied":
      return t("settings.general.notifications.blocked");
    case "failed":
      return t("settings.general.notifications.failed");
    default:
      return t("settings.general.notifications.testButton");
  }
}

function notificationTestTitle(status: NotificationTestState, t: (key: string) => string): string {
  switch (status) {
    case "waiting":
      return t("settings.general.notifications.switchAppsTitle");
    case "requested":
      return t("settings.general.notifications.requestedTitle");
    case "denied":
      return t("settings.general.notifications.blockedTitle");
    case "failed":
      return t("settings.general.notifications.failedTitle");
    default:
      return t("settings.general.notifications.testTitle");
  }
}

function FontFamilyInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const { t } = useTranslation();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Commit (and trim) only on blur/Enter so a trailing space can be typed
  // mid-edit, e.g. "JetBrains Mono ".
  const commit = () => {
    const next = draft.trim();
    if (next !== draft) setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <SettingRow
      title={t("settings.general.terminal.fontFamilyTitle")}
      description={t("settings.general.terminal.fontFamilyNerdHint")}
    >
      <input
        type="text"
        value={draft}
        placeholder={t("settings.general.terminal.fontFamilyPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-foreground/40"
      />
    </SettingRow>
  );
}
