import { invoke } from "@tauri-apps/api/core";
import {
  linearConnected,
  listLinearIssues,
  loadHiddenLinearTeamIds,
  type LinearIssue,
} from "./linear";
import { normalizeProjectPath } from "./recents";

export type GithubTaskKind = "issue" | "pr";
export type InboxKind = GithubTaskKind | "linear";

export type GithubLabel = {
  name: string;
  color: string;
};

export type GithubAssignee = {
  login: string;
};

export type GithubWorkItem = {
  kind: GithubTaskKind;
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string;
  labels: GithubLabel[];
  assignees: GithubAssignee[];
  draft: boolean;
  repo: string;
};

export type InboxProvider = "github" | "linear";

export type InboxItem = Omit<GithubWorkItem, "kind"> & {
  kind: InboxKind;
  projectPath: string;
  provider: InboxProvider;
  id?: string;
  identifier?: string;
  teamId?: string;
  teamName?: string;
  stateType?: string;
};

export type GithubWorkItemDetails = {
  body: string;
  author: string;
};

export type GithubWorkItemQuery = {
  kind: GithubTaskKind;
  assignedToMe: boolean;
  state: "open" | "all";
  search: string;
};

export type InboxQuery = Omit<GithubWorkItemQuery, "kind"> & {
  linearTeamIds?: string[];
};

const INBOX_CACHE_FRESH_MS = 30_000;

type InboxListCache = {
  key: string;
  items: InboxItem[];
  fetchedAt: number;
};

let inboxListCache: InboxListCache | null = null;
const inboxListInflight = new Map<string, Promise<InboxItem[]>>();
const repoByPath = new Map<string, string>();
const detailsByKey = new Map<string, GithubWorkItemDetails>();

export function clearInboxCache() {
  inboxListCache = null;
  inboxListInflight.clear();
  repoByPath.clear();
  detailsByKey.clear();
}

export function inboxListCacheKey(
  projects: readonly { path: string }[],
  query: InboxQuery,
): string {
  const paths = uniqueInboxProjects(projects)
    .map((project) => normalizeProjectPath(project.path))
    .sort()
    .join("|");
  const teams = [...(query.linearTeamIds ?? [])].sort().join(",");
  return `${query.assignedToMe ? 1 : 0}:${query.state}:${paths}:${teams}`;
}

export function peekInboxItems(
  projects: readonly { path: string }[],
  query: InboxQuery,
): InboxItem[] | null {
  const key = inboxListCacheKey(projects, query);
  return inboxListCache?.key === key ? inboxListCache.items : null;
}

export function inboxListIsFresh(
  projects: readonly { path: string }[],
  query: InboxQuery,
  now = Date.now(),
): boolean {
  const key = inboxListCacheKey(projects, query);
  return (
    inboxListCache?.key === key &&
    now - inboxListCache.fetchedAt < INBOX_CACHE_FRESH_MS
  );
}

export async function githubRepo(cwd: string): Promise<string> {
  const key = normalizeProjectPath(cwd);
  const cached = repoByPath.get(key);
  if (cached !== undefined) return cached;
  const repo = await invoke<string>("git_github_repo", { cwd });
  repoByPath.set(key, repo);
  return repo;
}

export function listGithubWorkItems(
  cwd: string,
  query: GithubWorkItemQuery,
): Promise<GithubWorkItem[]> {
  return invoke<GithubWorkItem[]>("git_github_work_items", {
    cwd,
    kind: query.kind,
    assignedToMe: query.assignedToMe,
    state: query.state,
    search: query.search.trim(),
  });
}

export function formatGithubQuery(query: GithubWorkItemQuery): string {
  const parts: string[] = [];
  if (query.assignedToMe) parts.push("assignee:@me");
  parts.push(query.kind === "pr" ? "is:pr" : "is:issue");
  if (query.state === "open") parts.push("is:open");
  const text = query.search.trim();
  if (text) parts.push(text);
  return parts.join(" ");
}

export function formatRelativeTime(
  iso: string,
  now = Date.now(),
  locale?: string,
): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const delta = Math.round((then - now) / 1000);
  const abs = Math.abs(delta);
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.34524, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = delta;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let amount = abs;
  for (const [step, next] of divisions) {
    unit = next;
    if (amount < step) break;
    value = Math.round(value / step);
    amount = Math.abs(value);
  }
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      value,
      unit,
    );
  } catch {
    return "";
  }
}

export function detailsCacheKey(
  cwd: string,
  kind: GithubTaskKind,
  number: number,
): string {
  return `${normalizeProjectPath(cwd)}:${kind}:${number}`;
}

export function peekGithubWorkItemDetails(
  cwd: string,
  kind: GithubTaskKind,
  number: number,
): GithubWorkItemDetails | null {
  return detailsByKey.get(detailsCacheKey(cwd, kind, number)) ?? null;
}

export async function githubWorkItemDetails(
  cwd: string,
  kind: GithubTaskKind,
  number: number,
): Promise<GithubWorkItemDetails> {
  const details = await invoke<GithubWorkItemDetails>(
    "git_github_work_item_details",
    { cwd, kind, number },
  );
  detailsByKey.set(detailsCacheKey(cwd, kind, number), details);
  return details;
}

export async function listInboxItems(
  projects: readonly { path: string }[],
  query: InboxQuery,
  options?: { force?: boolean },
): Promise<InboxItem[]> {
  const key = inboxListCacheKey(projects, query);
  if (!options?.force && inboxListIsFresh(projects, query)) {
    return inboxListCache?.items ?? [];
  }
  const pending = inboxListInflight.get(key);
  if (pending) return pending;
  const promise = fetchInboxItems(projects, query)
    .then((items) => {
      inboxListCache = { key, items, fetchedAt: Date.now() };
      return items;
    })
    .finally(() => {
      if (inboxListInflight.get(key) === promise) inboxListInflight.delete(key);
    });
  inboxListInflight.set(key, promise);
  return promise;
}

async function fetchInboxItems(
  projects: readonly { path: string }[],
  query: InboxQuery,
): Promise<InboxItem[]> {
  const unique = uniqueInboxProjects(projects);
  const resolved = await Promise.all(
    unique.map(async (project) => {
      try {
        return {
          path: project.path,
          repo: (await githubRepo(project.path)).trim(),
        };
      } catch {
        return { path: project.path, repo: "" };
      }
    }),
  );
  const grouped = groupProjectsByRepo(resolved);
  const jobs: Promise<InboxItem[]>[] = grouped.flatMap((project) =>
    (["issue", "pr"] as const).map(async (kind) => {
      const items = await listGithubWorkItems(project.path, {
        ...query,
        kind,
      });
      return items.map((item) => ({
        ...item,
        projectPath: project.path,
        provider: "github" as const,
        repo: item.repo || project.repo,
      }));
    }),
  );
  if ((await linearConnected()).connected) {
    jobs.push(fetchLinearInboxItems(query));
  }
  return collectInboxResults(
    await Promise.allSettled(jobs),
    unique.map((project) => project.path),
  );
}

async function fetchLinearInboxItems(query: InboxQuery): Promise<InboxItem[]> {
  const issues = await listLinearIssues({
    assignedToMe: query.assignedToMe,
    state: query.state,
    teamIds: query.linearTeamIds ?? [],
  });
  const hidden = new Set(loadHiddenLinearTeamIds());
  return issues
    .filter((issue) => hidden.size === 0 || !hidden.has(issue.teamId))
    .map(linearIssueToInboxItem);
}

function linearIssueToInboxItem(issue: LinearIssue): InboxItem {
  return {
    provider: "linear",
    kind: "linear",
    id: issue.id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateType: issue.stateType,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    assignees: issue.assignees,
    draft: false,
    repo: issue.repo,
    teamId: issue.teamId,
    teamName: issue.teamName,
    projectPath: issue.projectPath || "",
  };
}

export function uniqueInboxProjects(
  projects: readonly { path: string }[],
): { path: string }[] {
  const seen = new Set<string>();
  const unique: { path: string }[] = [];
  for (const project of projects) {
    const path = normalizeProjectPath(project.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push({ path });
  }
  return unique;
}

export function groupProjectsByRepo(
  resolved: readonly { path: string; repo: string }[],
): { path: string; repo: string }[] {
  const seen = new Set<string>();
  const grouped: { path: string; repo: string }[] = [];
  for (const project of resolved) {
    const repo = project.repo.trim().toLowerCase();
    const key = repo || `path:${normalizeProjectPath(project.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grouped.push({
      path: project.path,
      repo: project.repo.trim(),
    });
  }
  return grouped;
}

export function collectInboxResults(
  settled: PromiseSettledResult<InboxItem[]>[],
  preferredPaths: readonly string[] = [],
): InboxItem[] {
  const batches: InboxItem[][] = [];
  const errors: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") batches.push(result.value);
    else errors.push(result.reason);
  }
  if (batches.length === 0 && errors.length > 0) {
    const first = errors[0];
    throw first instanceof Error ? first : new Error(String(first));
  }
  return dedupeInboxItems(batches.flat(), preferredPaths);
}

export function inboxIdentityKey(item: {
  provider?: InboxProvider;
  kind: InboxKind;
  number: number;
  repo: string;
  url: string;
  identifier?: string;
  id?: string;
}): string {
  if (item.provider === "linear") {
    const identity = item.identifier?.trim() || item.id?.trim();
    if (identity) return identity.toLowerCase();
    return `linear:${item.number}`;
  }
  const repo = item.repo.trim().toLowerCase();
  if (repo) return `${repo}:${item.kind}:${item.number}`;
  const url = item.url.trim().toLowerCase();
  if (url) return url;
  return `${item.kind}:${item.number}`;
}

export function dedupeInboxItems(
  items: readonly InboxItem[],
  preferredPaths: readonly string[] = [],
): InboxItem[] {
  const rank = new Map(
    preferredPaths.map((path, index) => [normalizeProjectPath(path), index]),
  );
  const best = new Map<string, InboxItem>();
  for (const item of items) {
    const key = inboxIdentityKey(item);
    const current = best.get(key);
    if (!current || preferInboxItem(item, current, rank)) best.set(key, item);
  }
  return sortInboxItems([...best.values()]);
}

function preferInboxItem(
  next: InboxItem,
  current: InboxItem,
  rank: Map<string, number>,
): boolean {
  const nextRank =
    rank.get(normalizeProjectPath(next.projectPath)) ?? Number.POSITIVE_INFINITY;
  const currentRank =
    rank.get(normalizeProjectPath(current.projectPath)) ??
    Number.POSITIVE_INFINITY;
  if (nextRank !== currentRank) return nextRank < currentRank;
  return next.projectPath.localeCompare(current.projectPath) < 0;
}

export function sortInboxItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const updated = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    if (updated !== 0) return updated;
    if (a.projectPath !== b.projectPath) {
      return a.projectPath.localeCompare(b.projectPath);
    }
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return b.number - a.number;
  });
}

export function inboxItemKey(item: InboxItem): string {
  return `${item.provider}:${inboxIdentityKey(item)}`;
}

export function githubWorkItemKey(item: GithubWorkItem): string {
  return `${item.repo}:${item.kind}:${item.number}`;
}

export function inboxItemStatus(item: {
  kind: InboxKind;
  state: string;
  draft: boolean;
  stateType?: string;
}): string {
  if (item.kind === "linear") {
    const type = item.stateType?.trim().toLowerCase();
    if (type === "completed" || type === "canceled") return "Closed";
    return "Open";
  }
  if (item.draft) return "Draft";
  if (item.state === "merged") return "Merged";
  if (item.state === "closed") return "Closed";
  return "Open";
}

export function matchesInboxQuery(item: InboxItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const kind =
    item.kind === "pr"
      ? "pull request pr"
      : item.kind === "linear"
        ? "linear issue"
        : "issue";
  const haystack = [
    item.title,
    item.repo,
    item.projectPath,
    item.identifier,
    item.teamName,
    kind,
    `#${item.number}`,
    String(item.number),
    ...item.labels.map((label) => label.name),
    ...item.assignees.map((person) => person.login),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterInboxItems(
  items: readonly InboxItem[],
  query: string,
): InboxItem[] {
  return items.filter((item) => matchesInboxQuery(item, query));
}

export function inboxItemRef(item: {
  provider?: InboxProvider;
  number: number;
  identifier?: string;
}): string {
  if (item.provider === "linear") {
    return item.identifier?.trim() || `#${item.number}`;
  }
  return `#${item.number}`;
}

export function inboxStartDraft(item: InboxItem, body?: string): string {
  if (item.provider === "linear") {
    const id = item.identifier?.trim() || `Linear #${item.number}`;
    const title = item.title.trim() || id;
    const lines = ["Work on this Linear issue:", "", `${id} ${title}`];
    const url = item.url.trim();
    if (url) lines.push(url);
    const description = body?.trim();
    if (description) {
      lines.push("", description);
    }
    return `${lines.join("\n")}\n`;
  }
  const kind = item.kind === "pr" ? "pull request" : "issue";
  const title = item.title.trim() || `GitHub ${kind} #${item.number}`;
  const lines = [`Work on this GitHub ${kind}:`, "", `#${item.number} ${title}`];
  const url = item.url.trim();
  if (url) lines.push(url);
  return `${lines.join("\n")}\n`;
}

/** Compact chip shown above the composer when starting from Inbox. */
export type InboxComposerCard = {
  provider: InboxProvider;
  kind: InboxKind;
  identifier: string;
  title: string;
  url: string;
  source: string;
  labels: GithubLabel[];
  prompt: string;
};

export function inboxComposerCard(
  item: InboxItem,
  body?: string,
): InboxComposerCard {
  const linear = item.provider === "linear";
  return {
    provider: item.provider,
    kind: item.kind,
    identifier: inboxItemRef(item),
    title: item.title.trim() || inboxItemRef(item),
    url: item.url.trim(),
    source: linear ? item.teamName || item.repo : item.repo,
    labels: item.labels.slice(0, 2),
    prompt: inboxStartDraft(item, body).trimEnd(),
  };
}

export function composeInboxMessage(
  card: InboxComposerCard | undefined,
  text: string,
): string {
  const prompt = card?.prompt.trim() ?? "";
  const note = text.trim();
  if (!prompt) return note;
  if (!note) return prompt;
  return `${prompt}\n\n${note}`;
}
