import { fuzzyMatch } from "./fuzzy";
import { projectName } from "./paths";
import { sameProjectPath } from "./recents";
import { hasPendingApproval, sessionDisplayTitle, type Session } from "./session";
import { shouldPersistSession, type SessionSummary } from "./sessionStore";

export type SessionGitHint = {
  repo?: string;
  branch?: string;
};

export function mergeHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const previous = current.find((entry) => entry.id === summary.id);
  const next = {
    ...summary,
    archived: summary.archived ?? previous?.archived,
  };
  return [next, ...current.filter((entry) => entry.id !== summary.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

export function filterSessionsByArchive(
  rows: SessionSummary[],
  showArchived: boolean,
): SessionSummary[] {
  return rows.filter((row) => !!row.archived === showArchived);
}

export function filterSessionsByQuery(
  rows: SessionSummary[],
  query: string,
): SessionSummary[] {
  const needle = query.trim();
  if (!needle) return rows;
  return rows.filter((row) => sessionSearchHit(row, needle));
}

function sessionSearchHit(row: SessionSummary, query: string): boolean {
  const title = sessionDisplayTitle(row.title, row.harness);
  const git = [row.repo, row.branch].filter(Boolean).join("/");
  const fields = [title, row.title, row.model, row.harness, git];
  return fields.some((field) => field && fuzzyMatch(query, field) != null);
}

export function summaryFromSession(
  session: Session,
  git?: SessionGitHint,
): SessionSummary {
  return {
    id: session.id,
    cwd: session.cwd,
    harness: session.harness,
    model: session.model,
    runtimeMode: session.runtimeMode,
    title: session.title,
    providerSessionId: session.providerSessionId,
    ...(git?.branch ? { branch: git.branch } : {}),
    ...(git?.repo ? { repo: git.repo } : {}),
    createdAt: 0,
    updatedAt: Date.now(),
  };
}

/** Prefer the project's persisted origin name, then the overlay / folder name. */
export function projectGitHint(
  rows: SessionSummary[],
  overlay?: SessionGitHint,
): SessionGitHint {
  const repo = rows.find((row) => row.repo)?.repo ?? overlay?.repo;
  const branch = overlay?.branch ?? rows.find((row) => row.branch)?.branch;
  return {
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
  };
}

function gitOverlayForCwd(cwd: string, git?: SessionGitHint): SessionGitHint {
  if (git?.repo) return git;
  if (!cwd || cwd === "~") return git ?? {};
  const name = projectName(cwd);
  if (!name || name === "~") return git ?? {};
  return { ...git, repo: name };
}

export function historyWithLiveSessions(
  history: SessionSummary[],
  sessions: Session[],
  cwd: string,
  git?: SessionGitHint,
): SessionSummary[] {
  let rows = history.filter((entry) => sameProjectPath(entry.cwd, cwd));
  const hint = projectGitHint(rows, gitOverlayForCwd(cwd, git));
  for (const session of sessions) {
    if (!sameProjectPath(session.cwd, cwd)) continue;
    const live = session.busy || hasPendingApproval(session.blocks);
    if (!shouldPersistSession(session) && !live) continue;
    if (rows.some((row) => row.id === session.id)) continue;
    const sessionHint: SessionGitHint = {
      ...hint,
      ...(session.branch ? { branch: session.branch } : {}),
    };
    rows = mergeHistorySummary(rows, summaryFromSession(session, sessionHint));
  }
  return rows;
}
