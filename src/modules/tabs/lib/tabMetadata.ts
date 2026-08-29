const tabCreationTimes = new Map<number, number>();

export function recordTabCreation(
  tabId: number,
  timestamp: number = Date.now(),
): void {
  if (!tabCreationTimes.has(tabId)) {
    tabCreationTimes.set(tabId, timestamp);
  }
}

export function getTabUptimeMs(
  tabId: number,
  fallbackCreatedAt?: number,
): number {
  let created = tabCreationTimes.get(tabId);
  if (!created) {
    created = fallbackCreatedAt || Date.now();
    tabCreationTimes.set(tabId, created);
  }
  return Math.max(0, Date.now() - created);
}

export function removeTabCreation(tabId: number): void {
  tabCreationTimes.delete(tabId);
}

export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return `${hours}h ${remMinutes.toString().padStart(2, "0")}m`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

export function getTabPath(tab: unknown): string | null {
  if (!tab || typeof tab !== "object") return null;
  const candidate = tab as Record<string, unknown>;
  if (typeof candidate.path === "string" && candidate.path.trim().length > 0) {
    return candidate.path;
  }
  if (
    typeof candidate.repoRoot === "string" &&
    candidate.repoRoot.trim().length > 0
  ) {
    return candidate.repoRoot;
  }
  if (typeof candidate.cwd === "string" && candidate.cwd.trim().length > 0) {
    return candidate.cwd;
  }
  return null;
}
