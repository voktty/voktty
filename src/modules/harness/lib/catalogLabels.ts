import type { ModelSetting, ModelSettingChoice } from "./models";
import type { SettingsGroupId, SettingsSectionId } from "./settings";

type Translate = (key: string) => string;

const GROUP_LABEL_KEYS: Record<SettingsGroupId, string> = {
  app: "harness.settings.groups.app",
  agents: "harness.settings.groups.agents",
  workspace: "harness.settings.groups.workspace",
};

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
  chat: "harness.settings.chat",
  keybindings: "harness.modelSettings.keybindings",
  providers: "harness.settings.providers",
  inbox: "harness.settings.inbox",
  skills: "harness.settings.skills",
  archive: "harness.modelSettings.archive",
};

const SECTION_DESCRIPTION_KEYS: Record<SettingsSectionId, string> = {
  general: "harness.modelSettings.sectionDescriptions.general",
  appearance: "harness.modelSettings.sectionDescriptions.appearance",
  chat: "harness.modelSettings.sectionDescriptions.chat",
  keybindings: "harness.modelSettings.sectionDescriptions.keybindings",
  providers: "harness.modelSettings.sectionDescriptions.providers",
  inbox: "harness.modelSettings.sectionDescriptions.inbox",
  skills: "harness.modelSettings.sectionDescriptions.skills",
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

export function settingsGroupLabel(t: Translate, group: SettingsGroupId): string {
  return t(GROUP_LABEL_KEYS[group]);
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

const ENTRY_LABEL_KEYS: Record<string, string> = {
  update: "harness.settingsEntries.version",
  sounds: "harness.settingsEntries.sounds",
  notifications: "harness.settingsEntries.notifications",
  notes: "harness.settingsEntries.notes",
  "working-agents": "harness.settingsEntries.workingAgents",
  "close-to-tray": "harness.settingsEntries.closeToTray",
  theme: "harness.settingsEntries.theme",
  "accent-color": "harness.settingsEntries.accentColor",
  hue: "harness.settingsEntries.hue",
  saturation: "harness.settingsEntries.saturation",
  "dark-lightness": "harness.settingsEntries.darkLightness",
  "sidebar-opacity": "harness.settingsEntries.sidebarOpacity",
  blur: "harness.settingsEntries.blur",
  "main-pane-glass": "harness.settingsEntries.mainPaneGlass",
  "interface-scale": "harness.settingsEntries.interfaceScale",
  "chat-background": "harness.settingsEntries.chatBackground",
  "transcript-layout": "harness.settingsEntries.transcriptLayout",
  "anchor-prompts": "harness.settingsEntries.anchorPrompts",
  "follow-up": "harness.settingsEntries.followUp",
  "effort-control": "harness.settingsEntries.effortControl",
  "composer-mascot": "harness.settingsEntries.composerMascot",
  "diff-view": "harness.settingsEntries.diffView",
  "empty-session-games": "harness.settingsEntries.emptySessionGames",
  "provider-accounts": "harness.settingsEntries.providerAccounts",
  "claude-hooks": "harness.settingsEntries.claudeHooks",
  github: "harness.settingsEntries.github",
  gitlab: "harness.settingsEntries.gitlab",
  linear: "harness.settingsEntries.linear",
  "show-archived": "harness.settingsEntries.showArchived",
};

export function settingsEntryLabel(t: Translate, id: string): string {
  const key = ENTRY_LABEL_KEYS[id];
  return key ? t(key) : id;
}

const KEYBINDING_COMMAND_KEYS: Record<string, string> = {
  "App: Search": "harness.keybindings.commands.appSearch",
  "App: Go to File": "harness.keybindings.commands.goToFile",
  "App: Command Palette": "harness.keybindings.commands.commandPalette",
  "App: Find in Files": "harness.keybindings.commands.findInFiles",
  "App: Open Project": "harness.keybindings.commands.openProject",
  "App: New Window": "harness.keybindings.commands.newWindow",
  "App: Toggle Sidebar": "harness.keybindings.commands.toggleSidebar",
  "App: Toggle Zen Mode": "harness.keybindings.commands.toggleZen",
  "App: Switch Model": "harness.keybindings.commands.switchModel",
  "View: Reload": "harness.keybindings.commands.reload",
  "Tab: New": "harness.keybindings.commands.tabNew",
  "Tab: Next": "harness.keybindings.commands.tabNext",
  "Tab: Previous": "harness.keybindings.commands.tabPrevious",
  "Tab: Cycle Next": "harness.keybindings.commands.tabCycleNext",
  "Tab: Cycle Previous": "harness.keybindings.commands.tabCyclePrevious",
  "Tab: Back": "harness.keybindings.commands.tabBack",
  "Tab: Forward": "harness.keybindings.commands.tabForward",
  "Tab: Close Others": "harness.keybindings.commands.tabCloseOthers",
  "Tab: Activate 1–8": "harness.keybindings.commands.tabActivateRange",
  "Tab: Activate Last": "harness.keybindings.commands.tabActivateLast",
  "Session: Archive": "harness.keybindings.commands.sessionArchive",
  "Session: Previous": "harness.keybindings.commands.sessionPrevious",
  "Session: Next": "harness.keybindings.commands.sessionNext",
  "Project: Previous": "harness.keybindings.commands.projectPrevious",
  "Project: Next": "harness.keybindings.commands.projectNext",
  "Pane: Close": "harness.keybindings.commands.paneClose",
  "Pane: Split Right": "harness.keybindings.commands.paneSplitRight",
  "Pane: Split Down": "harness.keybindings.commands.paneSplitDown",
  "Pane: Focus Left": "harness.keybindings.commands.paneFocusLeft",
  "Pane: Focus Right": "harness.keybindings.commands.paneFocusRight",
  "Pane: Focus Up": "harness.keybindings.commands.paneFocusUp",
  "Pane: Focus Down": "harness.keybindings.commands.paneFocusDown",
  "Terminal: New": "harness.keybindings.commands.terminalNew",
  "Terminal: New Tab": "harness.keybindings.commands.terminalNewTab",
  "Terminal: Toggle Dock": "harness.keybindings.commands.terminalToggleDock",
  "Editor: Find": "harness.keybindings.commands.editorFind",
  "Editor: Replace": "harness.keybindings.commands.editorReplace",
};

export function keybindingCommandLabel(t: Translate, command: string): string {
  const key = KEYBINDING_COMMAND_KEYS[command];
  return key ? t(key) : command;
}

export function keybindingWhenLabel(t: Translate, when: string): string {
  return when === "Always" ? t("harness.keybindings.always") : when;
}

export function modelSettingDescription(
  t: Translate,
  setting: ModelSetting,
): string | undefined {
  if (setting.id === "fast") return t("harness.modelSettings.fastDescription");
  return setting.description;
}
