import { invoke } from "@tauri-apps/api/core";

export const JIRA_CHANGE_EVENT = "voktty:jira-changed";

export type JiraStatus = {
  connected: boolean;
  host: string;
};

export async function jiraConnected(): Promise<JiraStatus> {
  try {
    return await invoke<JiraStatus>("git_jira_status");
  } catch {
    return { connected: false, host: "" };
  }
}
