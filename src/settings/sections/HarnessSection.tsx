import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "@/modules/i18n";
import {
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

  const { t } = useTranslation();
  return (
    <>
      <Row
        label={t("harness.settings.workspaceLayout")}
        description={t("harness.settings.workspaceLayoutDesc")}
      >
        <Segmented
          label={t("harness.settings.workspaceLayout")}
          value={layout}
          options={[
            { value: "deck", label: t("harness.settings.deck") },
            { value: "classic", label: t("harness.settings.classic") },
          ]}
          onChange={(next) => { saveSidebarLayout(next); setLayout(next); }}
        />
      </Row>
      <Row
        label={t("harness.settings.transcriptLayout")}
        description={t("harness.settings.transcriptLayoutDesc")}
      >
        <Segmented
          label={t("harness.settings.transcriptLayout")}
          value={transcriptLayout}
          options={[
            { value: "full", label: t("harness.settings.fullWidth") },
            { value: "chat", label: t("harness.settings.chat") },
          ]}
          onChange={(next) => { saveTranscriptLayout(next); setTranscriptLayout(next); }}
        />
      </Row>
      <Row label={t("harness.settings.anchorPrompts")} description={t("harness.settings.anchorPromptsDesc")}>
        <HarnessToggle label={t("harness.settings.anchorPrompts")} on={transcriptAnchor} onChange={(next) => { saveTranscriptAnchor(next); setTranscriptAnchor(next); }} />
      </Row>
      <Row label={t("harness.settings.zenMode")} description={t("harness.settings.zenModeDesc", { shortcut: `${MOD}${ALT}Z` })}>
        <HarnessToggle label={t("harness.settings.zenMode")} on={transcriptZen} onChange={(next) => { saveTranscriptZen(next); setTranscriptZen(next); }} />
      </Row>
      <Row label={t("harness.settings.composerMascot")} description={t("harness.settings.composerMascotDesc")}>
        <HarnessToggle label={t("harness.settings.composerMascot")} on={composerRunner} onChange={(next) => { saveComposerRunner(next); setComposerRunner(next); }} />
      </Row>
      <Row label={t("harness.settings.emptySessionGames")} description={t("harness.settings.emptySessionGamesDesc")}>
        <HarnessToggle label={t("harness.settings.emptySessionGames")} on={gridArcadeEnabled} onChange={(next) => { saveGridArcadeEnabled(next); setGridArcadeEnabled(next); }} />
      </Row>
      <Row label={t("harness.settings.notes")} description={t("harness.settings.notesDesc")}>
        <HarnessToggle label={t("harness.settings.notes")} on={notesEnabled} onChange={(next) => { saveNotesEnabled(next); setNotesEnabled(next); }} />
      </Row>
      <Row label={t("harness.settings.workingAgents")} description={t("harness.settings.workingAgentsDesc")}>
        <HarnessToggle label={t("harness.settings.workingAgents")} on={liveAgentsEnabled} onChange={(next) => { saveLiveAgentsEnabled(next); setLiveAgentsEnabled(next); }} />
      </Row>
      <Row label={t("harness.settings.sounds")} description={t("harness.settings.soundsDesc")}>
        <HarnessToggle label={t("harness.settings.sounds")} on={soundsEnabled} onChange={(next) => { saveSoundsEnabled(next); setSoundsEnabled(next); }} />
      </Row>
      <Row label={t("harness.settings.claudeHooks")} description={t("harness.settings.claudeHooksDesc")}>
        <HarnessToggle label={t("harness.settings.claudeHooks")} on={claudeHooks} onChange={(next) => { saveClaudeHooks(next); setClaudeHooks(next); }} />
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
  const { t } = useTranslation();
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
            <span className="rounded-pill bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              {t("harness.settings.defaultBadge")}
            </span>
          ) : null}
        </span>
      }
      description={available ? t("harness.settings.modelsAvailable", { count: models.length }) : harnessUnavailableHint(harness)}
    >
      {current ? (
        <select
          aria-label={t("harness.settings.modelAria", { name: HARNESS_TITLE[harness] })}
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
        {isDefault ? t("harness.settings.defaultBadge") : t("harness.settings.useByDefault")}
      </Button>
      {available ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">{t("harness.settings.showInPicker")}</span>
          <HarnessToggle label={t("harness.settings.showInPickerAria", { name: HARNESS_TITLE[harness] })} on={inPicker} onChange={(visible) => { savePickerProviderVisible(harness, visible); setInPicker(visible); }} />
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

  const { t } = useTranslation();
  return (
    <>
      <p className="pb-3 text-[12px] leading-relaxed text-muted-foreground">
        {t("harness.settings.providersIntro")}
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
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {!hideHeader && (
        <SectionHeader
          title={t("harness.settings.title")}
          description={t("harness.settings.description")}
        />
      )}
      <SubHeading title={t("harness.settings.general")} />
      <GeneralBlock />
      <SubHeading title={t("harness.settings.providers")} />
      <ProvidersBlock />
    </div>
  );
}
