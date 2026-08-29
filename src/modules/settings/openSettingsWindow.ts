import { useSettingsModalStore } from "./settingsModalStore";

export type SettingsTab =
  | "general"
  | "editor"
  | "themes"
  | "shortcuts"
  | "models"
  | "agents"
  | "extensions"
  | "ssh"
  | "rdp"
  | "docker"
  | "mcp"
  | "vault"
  | "aliases"
  | "about";

export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  useSettingsModalStore.getState().openSettings(tab);
}

export function closeSettingsWindow(): void {
  useSettingsModalStore.getState().closeSettings();
}
