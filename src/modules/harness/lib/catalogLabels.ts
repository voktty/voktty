import type { ModelSetting, ModelSettingChoice } from "./models";
import type { SettingsSectionId } from "./settings";

type Translate = (key: string) => string;

const SETTING_LABEL_KEYS: Partial<Record<string, string>> = {
  effort: "harness.modelSettings.reasoning",
  reasoning: "harness.modelSettings.reasoning",
  reasoningEffort: "harness.modelSettings.reasoning",
  serviceTier: "harness.modelSettings.serviceTier",
  fast: "harness.modelSettings.fast",
  thinking: "harness.modelSettings.thinking",
  context: "harness.modelSettings.context",
  variant: "harness.modelSettings.variant",
  agent: "harness.modelSettings.agent",
};

const SECTION_LABEL_KEYS: Record<SettingsSectionId, string> = {
  general: "harness.settings.general",
  appearance: "harness.settings.appearance",
  keybindings: "harness.modelSettings.keybindings",
  providers: "harness.settings.providers",
  archive: "harness.modelSettings.archive",
};

const SECTION_DESCRIPTION_KEYS: Record<SettingsSectionId, string> = {
  general: "harness.modelSettings.sectionDescriptions.general",
  appearance: "harness.modelSettings.sectionDescriptions.appearance",
  keybindings: "harness.modelSettings.sectionDescriptions.keybindings",
  providers: "harness.modelSettings.sectionDescriptions.providers",
  archive: "harness.modelSettings.sectionDescriptions.archive",
};

export function modelSettingLabel(t: Translate, setting: ModelSetting): string {
  const key = SETTING_LABEL_KEYS[setting.id];
  return key ? t(key) : setting.label;
}

export function modelSettingOptionLabel(
  t: Translate,
  setting: ModelSetting,
  option: ModelSettingChoice,
): string {
  if (!SETTING_LABEL_KEYS[setting.id]) return option.label;

  if (option.value === "true") {
    return t(setting.id === "fast" ? "harness.modelSettings.fast" : "harness.modelSettings.on");
  }
  if (option.value === "false") return t("harness.modelSettings.off");

  const key = {
    xhigh: "harness.modelSettings.extraHigh",
    high: "harness.modelSettings.high",
    medium: "harness.modelSettings.medium",
    low: "harness.modelSettings.low",
    max: "harness.modelSettings.max",
    ultrathink: "harness.modelSettings.ultrathink",
    ultracode: "harness.modelSettings.ultracode",
    default: "harness.modelSettings.default",
    fast: "harness.modelSettings.fast",
    auto: "harness.modelSettings.auto",
    flex: "harness.modelSettings.flex",
  }[option.value];

  return key ? t(key) : option.label;
}

export function settingsSectionLabel(t: Translate, id: SettingsSectionId): string {
  return t(SECTION_LABEL_KEYS[id]);
}

export function settingsSectionDescription(
  t: Translate,
  id: SettingsSectionId,
): string {
  return t(SECTION_DESCRIPTION_KEYS[id]);
}
