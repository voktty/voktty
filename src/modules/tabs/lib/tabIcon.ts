export const TAB_AGENT_ICON_IDS = [
  "codex",
  "claude",
  "gemini",
  "opencode",
  "grok",
  "antigravity",
  "kimi",
  "deepseek",
  "qwen",
  "mistral",
  "perplexity",
] as const;

export const TAB_ICON_IDS = [
  "terminal",
  "server",
  "database",
  "cloud",
  "folder",
  "code",
  "browser",
  "git",
  "api",
  ...TAB_AGENT_ICON_IDS,
] as const;

export type TabIconId = (typeof TAB_ICON_IDS)[number];
export type TabAgentIconId = (typeof TAB_AGENT_ICON_IDS)[number];

type TabIconRouteSource = {
  kind: string;
  workspaceScopeId: string;
  cwd?: string;
  path?: string;
  repoRoot?: string;
  url?: string;
  host?: string;
};

const STORAGE_KEY = "voktty:tab-icons:routes";

export function isTabIconId(value: unknown): value is TabIconId {
  return (
    typeof value === "string" &&
    (TAB_ICON_IDS as readonly string[]).includes(value)
  );
}

export function isTabAgentIconId(value: TabIconId): value is TabAgentIconId {
  return (TAB_AGENT_ICON_IDS as readonly string[]).includes(value);
}

function normalizedPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.replace(
    /^([A-Z]):/,
    (_match: string, drive: string) => `${drive.toLowerCase()}:`,
  );
}

export function tabIconRouteKey(tab: TabIconRouteSource): string | null {
  const scope = tab.workspaceScopeId;
  if (tab.kind === "terminal" || tab.kind === "harness") {
    return tab.cwd ? `${scope}:cwd:${normalizedPath(tab.cwd)}` : null;
  }
  if (tab.path) return `${scope}:path:${normalizedPath(tab.path)}`;
  if (tab.repoRoot) return `${scope}:repo:${normalizedPath(tab.repoRoot)}`;
  if (tab.host) return `${scope}:host:${tab.host.toLowerCase()}`;
  if (tab.url) {
    try {
      return `${scope}:url:${new URL(tab.url).origin}`;
    } catch {
      return `${scope}:url:${tab.url}`;
    }
  }
  return null;
}

function loadPreferences(): Record<string, TabIconId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, TabIconId] =>
        isTabIconId(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function loadTabIconPreference(
  routeKey: string | null,
): TabIconId | null {
  if (!routeKey) return null;
  return loadPreferences()[routeKey] ?? null;
}

export function saveTabIconPreference(
  routeKey: string | null,
  icon: TabIconId | null,
): void {
  if (!routeKey) return;
  const next = loadPreferences();
  if (icon) next[routeKey] = icon;
  else delete next[routeKey];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A tab-level override still survives through the workspace snapshot.
  }
}
