import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  applyBodyGlass,
  applyThemePreference,
  applySidebarBlur,
  applySidebarOpacity,
  applyThemeTint,
  BODY_GLASS_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  loadBodyGlass,
  loadThemePreference,
  loadSidebarBlur,
  loadSidebarOpacity,
  loadThemeHue,
  loadThemeSaturation,
  saveBodyGlass,
  saveThemePreference,
  saveSidebarBlur,
  saveSidebarOpacity,
  saveThemeHue,
  saveThemeSaturation,
  SIDEBAR_BLUR_DEFAULT,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_OPACITY_DEFAULT,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  THEME_HUE_DEFAULT,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_DEFAULT,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  TRANSCRIPT_ZEN_CHANGE_EVENT,
  TRANSCRIPT_ANCHOR_CHANGE_EVENT,
  loadSidebarLayout,
  loadTranscriptLayout,
  loadTranscriptZen,
  loadTranscriptAnchor,
  saveSidebarLayout,
  saveTranscriptLayout,
  saveTranscriptZen,
  saveTranscriptAnchor,
  type SidebarLayout,
  type TranscriptLayout,
  type ThemePreference,
} from "@/modules/harness/lib/appearance";
import {
  getHarnessAvailabilitySnapshot,
  harnessUnavailableHint,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "@/modules/harness/lib/harness/availability";
import { refreshHarnessCatalogs } from "@/modules/harness/lib/harness/registry";
import {
  defaultModelId,
  getModelSnapshot,
  isPickerProviderVisible,
  loadDefaultModels,
  loadLastModelChoice,
  modelsFor,
  resolveModel,
  saveDefaultModel,
  saveLastModelChoice,
  savePickerProviderVisible,
  subscribeModels,
} from "@/modules/harness/lib/models";
import { MOD, ALT } from "@/modules/harness/lib/platform";
import {
  loadClaudeHooks,
  loadComposerRunner,
  loadGridArcadeEnabled,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  saveClaudeHooks,
  saveComposerRunner,
  saveGridArcadeEnabled,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
} from "@/modules/harness/lib/settings";
import { loadSoundsEnabled, playCue, saveSoundsEnabled } from "@/modules/harness/lib/sounds";
import {
  HARNESSES,
  HARNESS_TITLE,
  type HarnessId,
} from "@/modules/harness/lib/session";
import { HarnessIcon } from "@/modules/harness/chrome/HarnessIcon";
import { SectionHeader } from "../components/SectionHeader";
import { Button } from "@/components/ui/button";

function Row({
  label,
  description,
  children,
}: {
  label: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 border-b border-border/40 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {description ? (
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-0.5 rounded-md border border-border/60 p-0.5 text-[12px]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-[5px] px-3 py-1 transition-colors",
            value === option.value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function HarnessSlider({
  label,
  value,
  display,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        className="sidebar-opacity-slider min-w-0 flex-1"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-10 shrink-0 text-right text-[12px] text-foreground tabular-nums">
        {display}
      </span>
    </div>
  );
}

function HarnessToggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Switch
      aria-label={label}
      checked={on}
      onCheckedChange={(checked) => {
        playCue("switch");
        onChange(checked);
      }}
    />
  );
}

function SubHeading({ title }: { title: string }) {
  return (
    <h2 className="pt-6 pb-1 text-[12px] font-semibold text-muted-foreground uppercase tracking-widest">
      {title}
    </h2>
  );
}

function GeneralBlock() {
  const [layout, setLayout] = useState<SidebarLayout>(loadSidebarLayout);
  const [transcriptLayout, setTranscriptLayout] =
    useState<TranscriptLayout>(loadTranscriptLayout);
  const [transcriptZen, setTranscriptZen] = useState(loadTranscriptZen);
  const [transcriptAnchor, setTranscriptAnchor] = useState(loadTranscriptAnchor);
  const [composerRunner, setComposerRunner] = useState(loadComposerRunner);
  const [gridArcadeEnabled, setGridArcadeEnabled] = useState(loadGridArcadeEnabled);
  const [notesEnabled, setNotesEnabled] = useState(loadNotesEnabled);
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useState(loadLiveAgentsEnabled);
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const [claudeHooks, setClaudeHooks] = useState(loadClaudeHooks);

  useEffect(() => {
    const onZen = (event: Event) => {
      setTranscriptZen((event as CustomEvent<boolean>).detail === true);
    };
    const onAnchor = (event: Event) => {
      setTranscriptAnchor((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(TRANSCRIPT_ZEN_CHANGE_EVENT, onZen);
    window.addEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    return () => {
      window.removeEventListener(TRANSCRIPT_ZEN_CHANGE_EVENT, onZen);
      window.removeEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    };
  }, []);

  return (
    <>
      <Row
        label="Workspace layout"
        description="Classic keeps a single sidebar. Deck adds the project rail, workspace panel, and terminal dock."
      >
        <Segmented
          label="Workspace layout"
          value={layout}
          options={[
            { value: "deck", label: "Deck" },
            { value: "classic", label: "Classic" },
          ]}
          onChange={(next) => { saveSidebarLayout(next); setLayout(next); }}
        />
      </Row>
      <Row
        label="Transcript layout"
        description="Full width keeps prompts as a spanning card. Chat aligns them to the right."
      >
        <Segmented
          label="Transcript layout"
          value={transcriptLayout}
          options={[
            { value: "full", label: "Full width" },
            { value: "chat", label: "Chat" },
          ]}
          onChange={(next) => { saveTranscriptLayout(next); setTranscriptLayout(next); }}
        />
      </Row>
      <Row label="Anchor prompts to top" description="New prompts sit at the top of the transcript and replies grow below.">
        <HarnessToggle label="Anchor prompts to top" on={transcriptAnchor} onChange={(next) => { saveTranscriptAnchor(next); setTranscriptAnchor(next); }} />
      </Row>
      <Row label="Zen mode" description={`The agent work reads as collapsible groups. ${MOD}${ALT}Z toggles it.`}>
        <HarnessToggle label="Zen mode" on={transcriptZen} onChange={(next) => { saveTranscriptZen(next); setTranscriptZen(next); }} />
      </Row>
      <Row label="Composer mascot" description="When a turn is running, the project mascot runs along the composer.">
        <HarnessToggle label="Composer mascot" on={composerRunner} onChange={(next) => { saveComposerRunner(next); setComposerRunner(next); }} />
      </Row>
      <Row label="Empty session games" description="Pac-man and snake idle on the empty-session grid. Hover to take control.">
        <HarnessToggle label="Empty session games" on={gridArcadeEnabled} onChange={(next) => { saveGridArcadeEnabled(next); setGridArcadeEnabled(next); }} />
      </Row>
      <Row label="Notes" description="A global markdown notebook on the project rail.">
        <HarnessToggle label="Notes" on={notesEnabled} onChange={(next) => { saveNotesEnabled(next); setNotesEnabled(next); }} />
      </Row>
      <Row label="Working agents" description="When multiple chats are in flight, a card on the rail lists them.">
        <HarnessToggle label="Working agents" on={liveAgentsEnabled} onChange={(next) => { saveLiveAgentsEnabled(next); setLiveAgentsEnabled(next); }} />
      </Row>
      <Row label="Sounds" description="Short cues when a turn finishes or a new inbox item appears.">
        <HarnessToggle label="Sounds" on={soundsEnabled} onChange={(next) => { saveSoundsEnabled(next); setSoundsEnabled(next); }} />
      </Row>
      <Row label="Claude Code hooks" description="Run hooks from settings.json (PreToolUse, blocks, notifications). Takes effect on the next turn.">
        <HarnessToggle label="Claude Code hooks" on={claudeHooks} onChange={(next) => { saveClaudeHooks(next); setClaudeHooks(next); }} />
      </Row>
    </>
  );
}

function AppearanceBlock() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [opacity, setOpacity] = useState(loadSidebarOpacity);
  const [blur, setBlur] = useState(loadSidebarBlur);
  const [themeHue, setThemeHue] = useState(loadThemeHue);
  const [themeSaturation, setThemeSaturation] = useState(loadThemeSaturation);
  const [bodyGlass, setBodyGlass] = useState(loadBodyGlass);
  const percent = Math.round(opacity * 100);

  const onTint = (hue: number, saturation: number) => {
    const next = applyThemeTint(hue, saturation);
    saveThemeHue(next.hue);
    saveThemeSaturation(next.saturation);
    setThemeHue(next.hue);
    setThemeSaturation(next.saturation);
  };

  const restoreDefaults = () => {
    applyThemePreference(THEME_PREFERENCE_DEFAULT);
    saveThemePreference(THEME_PREFERENCE_DEFAULT);
    setThemePreference(THEME_PREFERENCE_DEFAULT);
    const op = applySidebarOpacity(SIDEBAR_OPACITY_DEFAULT);
    saveSidebarOpacity(op); setOpacity(op);
    const bl = applySidebarBlur(SIDEBAR_BLUR_DEFAULT);
    saveSidebarBlur(bl); setBlur(bl);
    onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    applyBodyGlass(BODY_GLASS_DEFAULT);
    saveBodyGlass(BODY_GLASS_DEFAULT);
    setBodyGlass(BODY_GLASS_DEFAULT);
  };

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={restoreDefaults}>
          Restore defaults
        </Button>
      </div>
      <Row label="Theme" description="System follows the OS. Dark and light share the same tint.">
        <Segmented
          label="Theme"
          value={themePreference}
          options={[
            { value: "system", label: "System" },
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onChange={(next) => { applyThemePreference(next); saveThemePreference(next); setThemePreference(next); }}
        />
      </Row>
      <Row label="Sidebar opacity" description="How much of the desktop shows through the sidebar.">
        <HarnessSlider label="Sidebar opacity" value={percent} display={`${percent}%`} min={Math.round(SIDEBAR_OPACITY_MIN * 100)} max={Math.round(SIDEBAR_OPACITY_MAX * 100)} onChange={(val) => { const next = applySidebarOpacity(val / 100); saveSidebarOpacity(next); setOpacity(next); }} />
      </Row>
      <Row label="Blur radius" description="Background blur behind the window.">
        <HarnessSlider label="Blur radius" value={blur} display={String(blur)} min={SIDEBAR_BLUR_MIN} max={SIDEBAR_BLUR_MAX} onChange={(val) => { const next = applySidebarBlur(val); saveSidebarBlur(next); setBlur(next); }} />
      </Row>
      <Row label="Hue" description="Base hue for accents and tinted surfaces.">
        <HarnessSlider label="Hue" value={themeHue} display={`${themeHue}°`} min={THEME_HUE_MIN} max={THEME_HUE_MAX} onChange={(val) => onTint(val, themeSaturation)} />
      </Row>
      <Row label="Saturation" description="How strongly the hue tints the interface.">
        <HarnessSlider label="Saturation" value={themeSaturation} display={`${themeSaturation}%`} min={THEME_SATURATION_MIN} max={THEME_SATURATION_MAX} onChange={(val) => onTint(themeHue, val)} />
      </Row>
      <Row label="Main pane glass" description="Extend the translucent treatment to the main pane behind sessions.">
        <HarnessToggle label="Main pane glass" on={bodyGlass} onChange={(next) => { applyBodyGlass(next); saveBodyGlass(next); setBodyGlass(next); }} />
      </Row>
    </>
  );
}

function ProviderRow({
  harness,
  selectedModel,
  isDefault,
  onDefault,
  onModelChange,
}: {
  harness: HarnessId;
  selectedModel: string;
  isDefault: boolean;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
}) {
  const models = modelsFor(harness);
  const available = isHarnessAvailable(harness);
  const current = models.length > 0 ? resolveModel(harness, selectedModel) : null;
  const [inPicker, setInPicker] = useState(() => isPickerProviderVisible(harness));

  useEffect(() => {
    if (!available || models.length > 0) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness, models.length]);

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          <HarnessIcon harness={harness} className="size-4 shrink-0" />
          {HARNESS_TITLE[harness]}
          {isDefault ? (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              Default
            </span>
          ) : null}
        </span>
      }
      description={available ? `${models.length} ${models.length === 1 ? "model" : "models"} available.` : harnessUnavailableHint(harness)}
    >
      {current ? (
        <select
          aria-label={`${HARNESS_TITLE[harness]} model`}
          value={current.id}
          onChange={(e) => onModelChange(harness, e.target.value)}
          className="max-w-52 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[12px] text-foreground outline-none hover:border-border"
        >
          {models.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      ) : null}
      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => current && onDefault(harness, current.id)} disabled={isDefault || !current}>
        {isDefault ? "Default" : "Use by default"}
      </Button>
      {available ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Show in picker</span>
          <HarnessToggle label={`Show ${HARNESS_TITLE[harness]} in picker`} on={inPicker} onChange={(visible) => { savePickerProviderVisible(harness, visible); setInPicker(visible); }} />
        </div>
      ) : null}
    </Row>
  );
}

function ProvidersBlock() {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  useSyncExternalStore(subscribeHarnessAvailability, getHarnessAvailabilitySnapshot, getHarnessAvailabilitySnapshot);
  const [choice, setChoice] = useState(loadLastModelChoice);
  const [defaultModels, setDefaultModels] = useState(loadDefaultModels);

  useEffect(() => { void probeHarnessAvailability(); }, []);

  const onModelChange = (harness: HarnessId, model: string) => {
    saveDefaultModel(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    if (choice?.harness === harness) { saveLastModelChoice(harness, model); setChoice({ harness, model }); }
  };

  const onDefault = (harness: HarnessId, model: string) => {
    saveLastModelChoice(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    setChoice({ harness, model });
  };

  return (
    <>
      <p className="pb-3 text-[12px] leading-relaxed text-muted-foreground">
        A provider is listed as installed once its CLI is found on your PATH. The model beside each provider is used for new sessions.
      </p>
      {HARNESSES.map((harness) => (
        <ProviderRow
          key={harness}
          harness={harness}
          selectedModel={defaultModels[harness] ?? (choice?.harness === harness ? choice.model : defaultModelId(harness))}
          isDefault={choice?.harness === harness}
          onDefault={onDefault}
          onModelChange={onModelChange}
        />
      ))}
    </>
  );
}

export function HarnessSection({ hideHeader }: { hideHeader?: boolean } = {}) {
  return (
    <div className="flex flex-col gap-2">
      {!hideHeader && (
        <SectionHeader
          title="Agent Harness"
          description="Behavior, appearance, and AI provider settings for the Agent Harness session pane."
        />
      )}
      <SubHeading title="General" />
      <GeneralBlock />
      <SubHeading title="Appearance" />
      <AppearanceBlock />
      <SubHeading title="Providers" />
      <ProvidersBlock />
    </div>
  );
}