import { invoke } from "@tauri-apps/api/core";

export const AZUREDEVOPS_CHANGE_EVENT = "voktty:azuredevops-changed";

export type AzureDevOpsStatus = {
  connected: boolean;
  url: string;
  organization: string;
};

export async function azureDevOpsConnected(): Promise<AzureDevOpsStatus> {
  try {
    return await invoke<AzureDevOpsStatus>("git_azuredevops_status");
  } catch {
    return { connected: false, url: "", organization: "" };
  }
}
