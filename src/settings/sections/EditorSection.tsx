import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  FORMATTER_LABELS,
  FORMATTERS,
} from "@/modules/editor/lib/externalFormat";
import { EXPOSED_LANGUAGES } from "@/modules/editor/lib/languageDefinitions";
import { useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AUTO_SAVE_DELAY_MAX,
  AUTO_SAVE_DELAY_MIN,
  clampAutoSaveDelay,
  clampEditorWordWrapColumn,
  EDITOR_FONT_SIZES,
  EDITOR_WORD_WRAP_COLUMN_MAX,
  EDITOR_WORD_WRAP_COLUMN_MIN,
  type EditorFormatter,
  setEditorAutoSave,
  setEditorAutoSaveDelay,
  setEditorCustomFormatCommand,
  setEditorFontSize,
  setEditorFormatOnSave,
  setEditorFormatter,
  setEditorFormatterByLang,
  setEditorMinimap,
  setEditorInlayHints,
  setEditorSemanticHighlighting,
  setEditorWordWrap,
  setEditorWordWrapColumn,
  setVimMode,
} from "@/modules/settings/store";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { LspServersGroup } from "../components/LspServersGroup";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const AUTO_SAVE_STEP = 100;

export function EditorSection() {
  const { t } = useTranslation();
  const editorFontSize = usePreferencesStore((s) => s.editorFontSize);
  const vimMode = usePreferencesStore((s) => s.vimMode);
  const editorWordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const editorMinimap = usePreferencesStore((s) => s.editorMinimap);
  const editorSemanticHighlighting = usePreferencesStore(
    (s) => s.editorSemanticHighlighting,
  );
  const editorInlayHints = usePreferencesStore((s) => s.editorInlayHints);
  const editorWordWrapColumn = usePreferencesStore(
    (s) => s.editorWordWrapColumn,
  );
  const editorAutoSave = usePreferencesStore((s) => s.editorAutoSave);
  const editorAutoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);
  const editorFormatOnSave = usePreferencesStore((s) => s.editorFormatOnSave);
  const editorFormatter = usePreferencesStore((s) => s.editorFormatter);
  const editorFormatterByLang = usePreferencesStore(
    (s) => s.editorFormatterByLang,
  );
  const usesCustom =
    editorFormatter === "custom" ||
    Object.values(editorFormatterByLang).includes("custom");

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("settings.editor.title")}
        description={t("settings.editor.description")}
      />

      <div className="flex flex-col gap-2">
        <Label>{t("settings.editor.display.title")}</Label>
        <SettingRow
          title={t("settings.editor.display.fontSizeTitle")}
          description={t("settings.editor.display.fontSizeDesc")}
        >
          <Select
            value={String(editorFontSize)}
            onValueChange={(v) => void setEditorFontSize(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITOR_FONT_SIZES.map((size) => (
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
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settings.editor.display.vimModeTitle")}</Label>
        <SettingRow
          title={t("settings.editor.display.vimModeTitle")}
          description={t("settings.editor.display.vimModeDesc")}
        >
          <Switch
            checked={vimMode}
            onCheckedChange={(v) => void setVimMode(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.editor.display.wordWrapTitle")}
          description={t("settings.editor.display.wordWrapDesc")}
        >
          <Switch
            checked={editorWordWrap}
            onCheckedChange={(v) => void setEditorWordWrap(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.editor.display.minimapTitle")}
          description={t("settings.editor.display.minimapDesc")}
        >
          <Switch
            checked={editorMinimap}
            onCheckedChange={(v) => void setEditorMinimap(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.editor.display.semanticHighlightingTitle")}
          description={t("settings.editor.display.semanticHighlightingDesc")}
        >
          <Switch
            checked={editorSemanticHighlighting}
            onCheckedChange={(value) =>
              void setEditorSemanticHighlighting(value)
            }
          />
        </SettingRow>
        <SettingRow
          title={t("settings.editor.display.inlayHintsTitle")}
          description={t("settings.editor.display.inlayHintsDesc")}
        >
          <Switch
            checked={editorInlayHints}
            onCheckedChange={(value) => void setEditorInlayHints(value)}
          />
        </SettingRow>
        {editorWordWrap && (
          <WordWrapColumnInput
            value={editorWordWrapColumn}
            onChange={(v) => void setEditorWordWrapColumn(v)}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settings.editor.formatting.title")}</Label>
        <SettingRow
          title={t("settings.editor.formatting.autoSaveTitle")}
          description={t("settings.editor.formatting.autoSaveDesc")}
        >
          <Switch
            checked={editorAutoSave}
            onCheckedChange={(v) => void setEditorAutoSave(v)}
          />
        </SettingRow>
        {editorAutoSave && (
          <AutoSaveDelayInput
            value={editorAutoSaveDelay}
            onChange={(v) => void setEditorAutoSaveDelay(v)}
          />
        )}
        <SettingRow
          title={t("settings.editor.formatting.formatOnSaveTitle")}
          description={t("settings.editor.formatting.formatOnSaveDesc")}
        >
          <Switch
            checked={editorFormatOnSave}
            onCheckedChange={(v) => void setEditorFormatOnSave(v)}
          />
        </SettingRow>
        {editorFormatOnSave && (
          <>
            <SettingRow
              title={t("settings.editor.formatting.defaultFormatterTitle")}
              description={t("settings.editor.formatting.defaultFormatterDesc")}
            >
              <FormatterSelect
                value={editorFormatter}
                onChange={(v) => void setEditorFormatter(v)}
              />
            </SettingRow>
            {usesCustom && <CustomFormatCommandInput />}
            <FormatterOverrides />
          </>
        )}
      </div>

      <LspServersGroup />
    </div>
  );
}

const FORMATTER_OPTIONS: EditorFormatter[] = [
  "lsp",
  ...(Object.keys(FORMATTERS) as EditorFormatter[]),
  "custom",
];

function FormatterSelect({
  value,
  onChange,
}: {
  value: EditorFormatter;
  onChange: (v: EditorFormatter) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as EditorFormatter)}>
      <SelectTrigger className="h-8 w-40 text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FORMATTER_OPTIONS.map((id) => (
          <SelectItem key={id} value={id}>
            {FORMATTER_LABELS[id]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CustomFormatCommandInput() {
  const { t } = useTranslation();
  const stored = usePreferencesStore((s) => s.editorCustomFormatCommand);
  const [draft, setDraft] = useState(stored);

  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  return (
    <SettingRow
      title={t("settings.editor.formatting.customCommandTitle")}
      description={t("settings.editor.formatting.customCommandDesc")}
    >
      <Input
        value={draft}
        placeholder="mytool --fix {file}"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== stored) void setEditorCustomFormatCommand(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 w-64 font-mono text-[12px] md:text-[12px]"
      />
    </SettingRow>
  );
}

function FormatterOverrides() {
  const { t } = useTranslation();
  const byLang = usePreferencesStore((s) => s.editorFormatterByLang);
  const entries = Object.entries(byLang);
  const unused = EXPOSED_LANGUAGES.filter((l) => !(l.ext in byLang));

  const update = (next: Record<string, EditorFormatter>) =>
    void setEditorFormatterByLang(next);

  return (
    <>
      <SettingRow
        title={t("settings.editor.formatting.languageOverridesTitle")}
        description={t("settings.editor.formatting.languageOverridesDesc")}
      >
        <button
          type="button"
          disabled={unused.length === 0}
          className="h-8 rounded-md border border-border px-3 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          onClick={() => {
            const first = unused[0];
            if (first) update({ ...byLang, [first.ext]: "lsp" });
          }}
        >
          {t("settings.editor.formatting.addOverride")}
        </button>
      </SettingRow>
      {entries.map(([lang, formatter]) => (
        <div
          key={lang}
          className="flex items-center justify-end gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5"
        >
          <Select
            value={lang}
            onValueChange={(nextLang) => {
              if (nextLang === lang) return;
              const next = { ...byLang };
              delete next[lang];
              next[nextLang] = formatter;
              update(next);
            }}
          >
            <SelectTrigger className="h-7 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPOSED_LANGUAGES.filter(
                (l) => l.ext === lang || !(l.ext in byLang),
              ).map((l) => (
                <SelectItem key={l.ext} value={l.ext}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormatterSelect
            value={formatter}
            onChange={(v) => update({ ...byLang, [lang]: v })}
          />
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t("settings.editor.formatting.removeOverride")}
            onClick={() => {
              const next = { ...byLang };
              delete next[lang];
              update(next);
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function AutoSaveDelayInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampAutoSaveDelay(n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <SettingRow
      title={t("settings.editor.formatting.autoSaveDelayTitle")}
      description={t("settings.editor.formatting.autoSaveDelayDesc")}
    >
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={AUTO_SAVE_DELAY_MIN}
          max={AUTO_SAVE_DELAY_MAX}
          step={AUTO_SAVE_STEP}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-muted-foreground">
          {t("settings.editor.formatting.autoSaveDelayUnit")}
        </span>
      </div>
    </SettingRow>
  );
}

function WordWrapColumnInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampEditorWordWrapColumn(n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <SettingRow
      title={t("settings.editor.display.wrapColumnTitle")}
      description={t("settings.editor.display.wrapColumnDesc")}
    >
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={EDITOR_WORD_WRAP_COLUMN_MIN}
          max={EDITOR_WORD_WRAP_COLUMN_MAX}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-muted-foreground">
          {t("settings.editor.display.wrapColumnUnit")}
        </span>
      </div>
    </SettingRow>
  );
}
