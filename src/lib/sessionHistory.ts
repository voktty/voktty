import { projectName } from "./paths";
import { sameProjectPath } from "./recents";
import { hasPendingApproval, type Session } from "./session";
import { shouldPersistSession, type SessionSummary } from "./sessionStore";

export type SessionGitHint = {
  repo?: string;
  branch?: string;
};

export function mergeHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  return [summary, ...current.filter((entry) => entry.id !== summary.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
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
    rows = mergeHistorySummary(rows, summaryFromSession(session, hint));
  }
  return rows;
}
