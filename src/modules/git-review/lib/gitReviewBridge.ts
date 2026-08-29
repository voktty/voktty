import { invoke } from "@tauri-apps/api/core";
import type {
  LineRange,
  MarkRangePayload,
  Reconciliation,
  ReviewSession,
  SessionReviewOverview,
} from "../types";

export async function openReviewSession(
  repoRoot: string,
  target = "worktree",
  baseRef?: string,
  headRef?: string,
): Promise<ReviewSession | null> {
  try {
    return await invoke<ReviewSession>("git_review_open_session", {
      repoRoot,
      target,
      baseRef,
      headRef,
    });
  } catch (err) {
    console.error("git_review_open_session error:", err);
    return null;
  }
}

export async function markFileViewed(
  repoRoot: string,
  target: string,
  path: string,
  content: string,
  viewed: boolean,
): Promise<boolean> {
  try {
    await invoke("git_review_mark_file", {
      repoRoot,
      target,
      path,
      content,
      viewed,
    });
    return true;
  } catch (err) {
    console.error("git_review_mark_file error:", err);
    return false;
  }
}

export async function markRangeClaim(
  repoRoot: string,
  target: string,
  path: string,
  blockId: string,
  blockLabel: string,
  content: string,
  ranges: LineRange[],
): Promise<boolean> {
  try {
    const payload: MarkRangePayload = {
      repoRoot,
      target,
      path,
      blockId,
      blockLabel,
      content,
      ranges,
    };
    await invoke("git_review_mark_range", { payload });
    return true;
  } catch (err) {
    console.error("git_review_mark_range error:", err);
    return false;
  }
}

export async function unmarkRangeClaim(
  repoRoot: string,
  target: string,
  path: string,
  blockId: string,
): Promise<boolean> {
  try {
    await invoke("git_review_unmark_range", {
      repoRoot,
      target,
      path,
      blockId,
    });
    return true;
  } catch (err) {
    console.error("git_review_unmark_range error:", err);
    return false;
  }
}

export async function reconcileFileReview(
  repoRoot: string,
  target: string,
  path: string,
  baseContent: string,
  headContent: string,
): Promise<Reconciliation | null> {
  try {
    return await invoke<Reconciliation>("git_review_reconcile_file", {
      repoRoot,
      target,
      path,
      baseContent,
      headContent,
    });
  } catch (err) {
    console.error("git_review_reconcile_file error:", err);
    return null;
  }
}

export async function getSessionReviewOverview(
  repoRoot: string,
  target = "worktree",
): Promise<SessionReviewOverview | null> {
  try {
    return await invoke<SessionReviewOverview>(
      "git_review_get_session_overview",
      {
        repoRoot,
        target,
      },
    );
  } catch (err) {
    console.error("git_review_get_session_overview error:", err);
    return null;
  }
}

export async function pruneReviewSessions(
  olderThanDays = 30,
): Promise<number> {
  try {
    return await invoke<number>("git_review_prune_sessions", {
      olderThanDays,
    });
  } catch (err) {
    console.error("git_review_prune_sessions error:", err);
    return 0;
  }
}

