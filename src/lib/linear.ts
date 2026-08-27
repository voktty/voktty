import { invoke } from "@tauri-apps/api/core";

export type LinearTeam = {
  id: string;
  key: string;
  name: string;
};

export type LinearIssue = {
  provider: "linear";
  kind: "linear";
  id: string;
  identifier: string;
  number: number;
  title: string;
  url: string;
  state: string;
  stateType: string;
  updatedAt: string;
  labels: { name: string; color: string }[];
  assignees: { login: string }[];
  draft: boolean;
  repo: string;
  teamId: string;
  teamName: string;
  projectPath: string;
};

export type LinearIssueDetails = {
  body: string;
  author: string;
};

export type LinearStatus = {
  connected: boolean;
};

const TEAM_IDS_KEY = "monocode.linearHiddenTeams";
export const LINEAR_CHANGE_EVENT = "monocode:linear-change";

const detailsById = new Map<string, LinearIssueDetails>();

export function linearConnected(): Promise<LinearStatus> {
  return invoke<LinearStatus>("linear_status");
}

export function saveLinearToken(token: string): Promise<LinearStatus> {
  return invoke<LinearStatus>("linear_set_token", { token: token.trim() });
}

export function disconnectLinear(): Promise<LinearStatus> {
  return invoke<LinearStatus>("linear_set_token", { token: "" });
}

export function listLinearTeams(): Promise<LinearTeam[]> {
  return invoke<LinearTeam[]>("linear_list_teams");
}

/** `null` means do not filter by team. `[]` means every known team is hidden. */
export function linearTeamIdsForFetch(
  teams: readonly LinearTeam[],
  hiddenIds: readonly string[],
): string[] | null {
  if (hiddenIds.length === 0) return null;
  const hidden = new Set(hiddenIds);
  const visible = teams
    .filter((team) => !hidden.has(team.id))
    .map((team) => team.id);
  if (visible.length === teams.length) return null;
  return visible;
}

export function listLinearIssues(query: {
  assignedToMe: boolean;
  state: "open" | "all";
  teamIds: string[];
}): Promise<LinearIssue[]> {
  return invoke<LinearIssue[]>("linear_list_issues", {
    assignedToMe: query.assignedToMe,
    state: query.state,
    teamIds: query.teamIds,
  });
}

export function peekLinearIssueDetails(id: string): LinearIssueDetails | null {
  return detailsById.get(id) ?? null;
}

export async function linearIssueDetails(
  id: string,
): Promise<LinearIssueDetails> {
  const details = await invoke<LinearIssueDetails>("linear_issue_details", {
    id,
  });
  detailsById.set(id, details);
  return details;
}

export function loadHiddenLinearTeamIds(): string[] {
  try {
    const raw = localStorage.getItem(TEAM_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  } catch {
    return [];
  }
}

export function saveHiddenLinearTeamIds(ids: string[]) {
  try {
    localStorage.setItem(TEAM_IDS_KEY, JSON.stringify(ids));
  } catch {
    // private mode / quota
  }
  notifyLinearChange();
}

export function notifyLinearChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LINEAR_CHANGE_EVENT));
}
