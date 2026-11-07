import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import type { SettingsSectionId } from "./settings";

const TAB_FOR_SECTION: Record<SettingsSectionId, SettingsTab> = {
  general: "harness",
  appearance: "themes",
  chat: "agentic",
  keybindings: "shortcuts",
  providers: "harness",
  inbox: "integrations",
  connections: "projects",
  skills: "agentic",
  mcp: "agentic",
  worktrees: "projects",
  archive: "projects",
};

/** Harness settings live in the general Voktty settings; this maps the old section ids. */
export function settingsTabForSection(
  section: SettingsSectionId | undefined,
): SettingsTab {
  return section ? TAB_FOR_SECTION[section] : "harness";
}
