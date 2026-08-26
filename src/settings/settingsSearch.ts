import type { SettingsTab } from "@/modules/settings/openSettingsWindow";

export type SettingsSearchEntry = {
  id: string;
  tab: SettingsTab;
  titleKey: string;
  descriptionKey?: string;
  targetTitleKey?: string;
};

const section = (
  id: string,
  tab: SettingsTab,
  titleKey: string,
  descriptionKey?: string,
): SettingsSearchEntry => ({
  id,
  tab,
  titleKey,
  descriptionKey,
  targetTitleKey: titleKey,
});

const row = (
  id: string,
  tab: SettingsTab,
  titleKey: string,
  descriptionKey?: string,
): SettingsSearchEntry => ({
  id,
  tab,
  titleKey,
  descriptionKey,
  targetTitleKey: titleKey,
});

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  section("general", "general", "settings.tabs.general", "settings.general.description"),
  section("general-appearance", "general", "settings.general.appearance.title"),
  row("general-language", "general", "settings.general.language.title", "settings.general.language.description"),
  section("general-zoom", "general", "settings.general.zoom.title", "settings.general.zoom.label"),
  row("general-tabs", "general", "settings.general.tabs.layoutTitle", "settings.general.tabs.layoutDesc"),
  row("general-explorer-hidden", "general", "settings.general.explorer.showHiddenTitle", "settings.general.explorer.showHiddenDesc"),
  row("general-explorer-git", "general", "settings.general.explorer.gitDecorationsTitle", "settings.general.explorer.gitDecorationsDesc"),
  row("general-terminal-webgl", "general", "settings.general.terminal.webglTitle", "settings.general.terminal.webglDesc"),
  row("general-terminal-blink", "general", "settings.general.terminal.cursorBlinkTitle", "settings.general.terminal.cursorBlinkDesc"),
  row("general-terminal-cursor", "general", "settings.general.terminal.cursorStyleTitle", "settings.general.terminal.cursorStyleDesc"),
  row("general-terminal-font-family", "general", "settings.general.terminal.fontFamilyTitle", "settings.general.terminal.fontFamilyNerdHint"),
  row("general-terminal-font-weight", "general", "settings.general.terminal.fontWeightTitle", "settings.general.terminal.fontWeightDesc"),
  row("general-terminal-shell", "general", "settings.general.terminal.shellTitle", "settings.general.terminal.shellDesc"),
  row("general-terminal-environment", "general", "settings.general.window.defaultEnvTitle", "settings.general.window.defaultEnvDesc"),
  row("general-space-view-limit", "general", "settings.general.window.spaceViewLimitTitle", "settings.general.window.spaceViewLimitDesc"),
  row("general-terminal-spacing", "general", "settings.general.terminal.letterSpacingTitle", "settings.general.terminal.letterSpacingDesc"),
  row("general-terminal-font-size", "general", "settings.general.terminal.fontSizeTitle", "settings.general.terminal.fontSizeDesc"),
  row("general-terminal-scrollback", "general", "settings.general.terminal.scrollbackTitle", "settings.general.terminal.scrollbackDesc"),
  row("general-terminal-confirm-close", "general", "settings.general.terminal.confirmCloseTitle", "settings.general.terminal.confirmCloseDesc"),
  row("general-notifications-ui-sound", "general", "settings.general.notifications.soundEnabledTitle", "settings.general.notifications.soundEnabledDesc"),
  row("general-notifications-volume", "general", "settings.general.notifications.soundVolumeTitle", "settings.general.notifications.soundVolumeDesc"),
  row("general-notifications-agents", "general", "settings.general.notifications.agentNotificationsTitle", "settings.general.notifications.agentNotificationsDesc"),
  row("general-notifications-sound", "general", "settings.general.notifications.soundTitle", "settings.general.notifications.soundDesc"),
  row("general-autostart", "general", "settings.general.window.autostartTitle", "settings.general.window.autostartDesc"),
  row("general-restore-window", "general", "settings.general.window.restoreStateTitle", "settings.general.window.restoreStateDesc"),
  section("general-backup", "general", "settings.general.backup.title", "settings.general.backup.description"),
  section("general-backup-export", "general", "settings.general.backup.exportTitle", "settings.general.backup.exportDesc"),
  section("general-backup-import", "general", "settings.general.backup.importTitle", "settings.general.backup.importDesc"),

  section("editor", "editor", "settings.tabs.editor", "settings.editor.description"),
  row("editor-font-size", "editor", "settings.editor.display.fontSizeTitle", "settings.editor.display.fontSizeDesc"),
  row("editor-vim", "editor", "settings.editor.display.vimModeTitle", "settings.editor.display.vimModeDesc"),
  row("editor-word-wrap", "editor", "settings.editor.display.wordWrapTitle", "settings.editor.display.wordWrapDesc"),
  row("editor-minimap", "editor", "settings.editor.display.minimapTitle", "settings.editor.display.minimapDesc"),
  row("editor-auto-save", "editor", "settings.editor.formatting.autoSaveTitle", "settings.editor.formatting.autoSaveDesc"),
  row("editor-auto-save-delay", "editor", "settings.editor.formatting.autoSaveDelayTitle", "settings.editor.formatting.autoSaveDelayDesc"),
  row("editor-format-on-save", "editor", "settings.editor.formatting.formatOnSaveTitle", "settings.editor.formatting.formatOnSaveDesc"),
  row("editor-formatter", "editor", "settings.editor.formatting.defaultFormatterTitle", "settings.editor.formatting.defaultFormatterDesc"),
  row("editor-custom-command", "editor", "settings.editor.formatting.customCommandTitle", "settings.editor.formatting.customCommandDesc"),
  row("editor-language-overrides", "editor", "settings.editor.formatting.languageOverridesTitle", "settings.editor.formatting.languageOverridesDesc"),
  row("editor-wrap-column", "editor", "settings.editor.display.wrapColumnTitle", "settings.editor.display.wrapColumnDesc"),
  section("editor-lsp", "editor", "settings.editor.lsp.title", "settings.editor.lsp.description"),
  section("editor-autocomplete", "editor", "settings.editor.autocomplete.title", "settings.editor.autocomplete.description"),

  section("themes", "themes", "settings.tabs.themes", "settings.themes.description"),
  section("themes-app", "themes", "settings.themes.appThemes.title", "settings.themes.appThemes.description"),
  section("themes-editor", "themes", "settings.editor.display.themeTitle", "settings.editor.display.themeDesc"),
  section("themes-background", "themes", "settings.themes.background.title", "settings.themes.background.description"),
  section("shortcuts", "shortcuts", "settings.tabs.shortcuts", "settings.shortcuts.description"),

  section("models", "models", "settings.tabs.models", "settings.models.description"),
  section("models-api-key", "models", "settings.models.apiKey"),
  section("models-base-url", "models", "settings.models.baseUrl"),
  section("models-model-id", "models", "settings.models.modelId"),
  section("models-default", "models", "settings.models.defaultModel"),
  section("models-chat", "models", "settings.models.chatModel"),
  section("models-autocomplete", "models", "settings.models.autocomplete"),
  section("models-voice", "models", "settings.models.voiceInput"),
  section("models-context", "models", "settings.models.contextLabel"),

  section("agents", "agents", "settings.tabs.agents", "settings.agents.description"),
  section("agents-instructions", "agents", "settings.agents.customInstructionsTitle", "settings.agents.customInstructionsDesc"),
  section("agents-terminal", "agents", "settings.agents.terminalAgentsTitle", "settings.agents.terminalAgentsDesc"),
  section("agents-hooks", "agents", "settings.agents.enableHooks", "settings.agents.hooksDescription"),
  section("agents-snippets", "agents", "settings.agents.snippets", "settings.agents.snippetsDesc"),

  section("extensions", "extensions", "extensions.title", "extensions.description"),
  section("ssh", "ssh", "settings.tabs.ssh"),
  section("rdp", "rdp", "rdp.section.title", "rdp.section.description"),
  section("docker", "docker", "settings.tabs.docker", "settings.docker.subtitle"),
  row("docker-enabled", "docker", "settings.docker.enable", "settings.docker.enableDesc"),
  row("docker-host", "docker", "settings.docker.customHost", "settings.docker.customHostDesc"),
  row("docker-shell", "docker", "settings.docker.defaultShell", "settings.docker.defaultShellDesc"),
  section("mcp", "mcp", "settings.tabs.mcp", "settings.mcp.description"),
  row("mcp-add", "mcp", "settings.mcp.addServer", "settings.mcp.empty.description"),
  section("vault", "vault", "settings.tabs.vault", "vault.description"),
  section("about", "about", "settings.tabs.about", "settings.about.description"),
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function searchSettings(
  query: string,
  translate: (key: string) => string,
): SettingsSearchEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return SETTINGS_SEARCH_ENTRIES.map((entry) => {
    const title = translate(entry.titleKey);
    const description = entry.descriptionKey
      ? translate(entry.descriptionKey)
      : "";
    const normalizedTitle = normalize(title);
    const searchableText = normalize(`${title} ${description}`);
    if (!queryTokens.every((token) => searchableText.includes(token))) return null;

    let score = 0;
    if (normalizedTitle === normalizedQuery) score += 100;
    if (normalizedTitle.startsWith(normalizedQuery)) score += 40;
    if (searchableText.includes(normalizedQuery)) score += 20;
    score += queryTokens.filter((token) => normalizedTitle.includes(token)).length * 5;

    return { entry, score, title };
  })
    .filter(
      (result): result is { entry: SettingsSearchEntry; score: number; title: string } =>
        result !== null,
    )
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .map((result) => result.entry);
}

export function navigateToSettingsEntry(
  entry: SettingsSearchEntry,
  targetTitle: string | undefined,
  setActive: (tab: SettingsTab) => void,
): void {
  setActive(entry.tab);

  let attempts = 0;
  const findTarget = () => {
    const section = document.querySelector<HTMLElement>(
      `[data-settings-section="${entry.tab}"]`,
    );
    const target = targetTitle
      ? Array.from(
          section?.querySelectorAll<HTMLElement>("[data-setting-title]") ?? [],
        ).find((element) => element.dataset.settingTitle === targetTitle)
      : undefined;
    const element = target ?? section;

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: target ? "center" : "start",
      });
      if (target) {
        target.dataset.settingsSearchHighlight = "true";
        window.setTimeout(() => {
          delete target.dataset.settingsSearchHighlight;
        }, 1400);
      }
      return;
    }

    attempts += 1;
    if (attempts < 60) window.requestAnimationFrame(findTarget);
  };

  window.requestAnimationFrame(findTarget);
}
