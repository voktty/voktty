import { create } from "zustand";
import {
  addReviewComment,
  deleteReviewComment,
  getReviewComments,
  getSessionReviewOverview,
  markFileViewed,
  reconcileFileReview,
  updateReviewComment,
} from "../lib/gitReviewBridge";
import type {
  AddReviewCommentPayload,
  Reconciliation,
  ReviewComment,
  SessionReviewOverview,
} from "../types";

export function sessionKey(repoRoot: string, target = "worktree"): string {
  return `${repoRoot.replace(/[\\/]+$/, "")}#${target}`;
}

export function fileKey(repoRoot: string, target: string, path: string): string {
  return `${sessionKey(repoRoot, target)}#${path.replace(/^[\\/]+/, "")}`;
}

interface GitReviewStoreState {
  overviews: Record<string, SessionReviewOverview>;
  reconciliations: Record<string, Reconciliation>;
  viewModes: Record<string, "unreviewed" | "full">;
  comments: Record<string, ReviewComment[]>;
  isLoading: boolean;

  loadOverview: (
    repoRoot: string,
    target?: string,
  ) => Promise<SessionReviewOverview | null>;
  markFile: (
    repoRoot: string,
    target: string,
    path: string,
    content: string,
    viewed: boolean,
  ) => Promise<boolean>;
  reconcileFile: (
    repoRoot: string,
    target: string,
    path: string,
    baseContent: string,
    headContent: string,
  ) => Promise<Reconciliation | null>;
  setViewMode: (
    repoRoot: string,
    target: string,
    path: string,
    mode: "unreviewed" | "full",
  ) => void;
  loadComments: (
    repoRoot: string,
    target?: string,
  ) => Promise<ReviewComment[]>;
  addComment: (
    payload: AddReviewCommentPayload,
  ) => Promise<ReviewComment | null>;
  updateComment: (
    repoRoot: string,
    target: string,
    commentId: string,
    comment: string,
  ) => Promise<boolean>;
  deleteComment: (
    repoRoot: string,
    target: string,
    commentId: string,
  ) => Promise<boolean>;
  buildHandoffPrompt: (
    repoRoot: string,
    target?: string,
  ) => string;
}

export const useGitReviewStore = create<GitReviewStoreState>((set, get) => ({
  overviews: {},
  reconciliations: {},
  viewModes: {},
  comments: {},
  isLoading: false,

  loadOverview: async (repoRoot: string, target = "worktree") => {
    const key = sessionKey(repoRoot, target);
    try {
      const overview = await getSessionReviewOverview(repoRoot, target);
      if (overview) {
        set((state) => ({
          overviews: {
            ...state.overviews,
            [key]: overview,
          },
        }));
      }
      return overview;
    } catch (err) {
      console.error("loadOverview error:", err);
      return null;
    }
  },

  markFile: async (
    repoRoot: string,
    target: string,
    path: string,
    content: string,
    viewed: boolean,
  ) => {
    const fKey = fileKey(repoRoot, target, path);
    try {
      const ok = await markFileViewed(repoRoot, target, path, content, viewed);
      if (ok) {
        // Invalidate and reload overview
        await get().loadOverview(repoRoot, target);
        // Clear cached reconciliation for this file so it recalculates freshly
        set((state) => {
          const nextReconciliations = { ...state.reconciliations };
          delete nextReconciliations[fKey];
          return { reconciliations: nextReconciliations };
        });
      }
      return ok;
    } catch (err) {
      console.error("markFile error:", err);
      return false;
    }
  },

  reconcileFile: async (
    repoRoot: string,
    target: string,
    path: string,
    baseContent: string,
    headContent: string,
  ) => {
    const fKey = fileKey(repoRoot, target, path);
    try {
      const rec = await reconcileFileReview(
        repoRoot,
        target,
        path,
        baseContent,
        headContent,
      );
      if (rec) {
        set((state) => ({
          reconciliations: {
            ...state.reconciliations,
            [fKey]: rec,
          },
        }));
      }
      return rec;
    } catch (err) {
      console.error("reconcileFile error:", err);
      return null;
    }
  },

  setViewMode: (
    repoRoot: string,
    target: string,
    path: string,
    mode: "unreviewed" | "full",
  ) => {
    const fKey = fileKey(repoRoot, target, path);
    set((state) => ({
      viewModes: {
        ...state.viewModes,
        [fKey]: mode,
      },
    }));
  },

  loadComments: async (repoRoot: string, target = "worktree") => {
    const key = sessionKey(repoRoot, target);
    try {
      const comments = await getReviewComments(repoRoot, target);
      set((state) => ({
        comments: {
          ...state.comments,
          [key]: comments,
        },
      }));
      return comments;
    } catch (err) {
      console.error("loadComments error:", err);
      return [];
    }
  },

  addComment: async (payload: AddReviewCommentPayload) => {
    const key = sessionKey(payload.repoRoot, payload.target);
    try {
      const newComment = await addReviewComment(payload);
      if (newComment) {
        set((state) => {
          const current = state.comments[key] ?? [];
          return {
            comments: {
              ...state.comments,
              [key]: [...current, newComment],
            },
          };
        });
      }
      return newComment;
    } catch (err) {
      console.error("addComment error:", err);
      return null;
    }
  },

  updateComment: async (
    repoRoot: string,
    target: string,
    commentId: string,
    comment: string,
  ) => {
    const key = sessionKey(repoRoot, target);
    try {
      const ok = await updateReviewComment(repoRoot, target, commentId, comment);
      if (ok) {
        set((state) => {
          const current = state.comments[key] ?? [];
          const updated = current.map((c) =>
            c.id === commentId ? { ...c, comment, updatedAt: Date.now() } : c,
          );
          return {
            comments: {
              ...state.comments,
              [key]: updated,
            },
          };
        });
      }
      return ok;
    } catch (err) {
      console.error("updateComment error:", err);
      return false;
    }
  },

  deleteComment: async (
    repoRoot: string,
    target: string,
    commentId: string,
  ) => {
    const key = sessionKey(repoRoot, target);
    try {
      const ok = await deleteReviewComment(repoRoot, target, commentId);
      if (ok) {
        set((state) => {
          const current = state.comments[key] ?? [];
          const filtered = current.filter((c) => c.id !== commentId);
          return {
            comments: {
              ...state.comments,
              [key]: filtered,
            },
          };
        });
      }
      return ok;
    } catch (err) {
      console.error("deleteComment error:", err);
      return false;
    }
  },

  buildHandoffPrompt: (repoRoot: string, target = "worktree") => {
    const key = sessionKey(repoRoot, target);
    const comments = get().comments[key] ?? [];
    const overview = get().overviews[key];
    const totalFiles = overview?.files.length ?? 0;
    const reviewedCount = overview?.files.filter((f) => f.reviewed).length ?? 0;

    let prompt = `## Code Review Feedback\n\n`;
    prompt += `- **Repository**: \`${repoRoot}\`\n`;
    prompt += `- **Scope**: \`${target}\`\n`;
    if (totalFiles > 0) {
      prompt += `- **Reviewed Files**: ${reviewedCount}/${totalFiles}\n`;
    }
    prompt += `\n### Actionable Review Comments (${comments.length})\n\n`;

    if (comments.length === 0) {
      prompt += `*All inspected files look good. No inline issues noted.*\n`;
    } else {
      comments.forEach((c, index) => {
        const lineStr = c.endLine && c.endLine > c.line ? `${c.line}-${c.endLine}` : `${c.line}`;
        prompt += `#### ${index + 1}. \`${c.path}:${lineStr}\` (${c.side === "new" ? "added/modified" : "original"})\n`;
        prompt += `> ${c.comment.replace(/\n/g, "\n> ")}\n\n`;
      });
    }

    prompt += `---\n**Instructions for Agent:**\n`;
    prompt += `1. Review and address each inline comment above.\n`;
    prompt += `2. Ensure all project tests, types, and quality checks pass.\n`;
    prompt += `3. Provide a concise summary of the changes made.\n`;

    return prompt;
  },
}));

