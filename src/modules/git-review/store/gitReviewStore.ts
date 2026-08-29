import { create } from "zustand";
import {
  getSessionReviewOverview,
  markFileViewed,
  reconcileFileReview,
} from "../lib/gitReviewBridge";
import type { Reconciliation, SessionReviewOverview } from "../types";

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
}

export const useGitReviewStore = create<GitReviewStoreState>((set, get) => ({
  overviews: {},
  reconciliations: {},
  viewModes: {},
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
}));
