import { create } from "zustand";
import type { RecentProject } from "./recents";
import type { SessionSummary } from "./sessionStore";

export type HarnessSettingsContext = {
  cwd: string;
  recents: RecentProject[];
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject: (path: string) => void;
  onDeleteProject: (path: string) => void;
};

type BridgeState = {
  owner: symbol | null;
  context: HarnessSettingsContext | null;
};

export const useHarnessSettingsBridge = create<BridgeState>(() => ({
  owner: null,
  context: null,
}));

/**
 * The general settings modal lives outside the Harness tree. The visible
 * Harness view publishes its project context here so settings pages that act
 * on a project (worktrees, archive, skills) work without a second settings UI.
 * Only the latest publisher is current; releasing a stale owner is a no-op.
 */
export function publishHarnessSettingsContext(
  context: HarnessSettingsContext,
  owner: symbol,
): () => void {
  useHarnessSettingsBridge.setState({ owner, context });
  return () => {
    if (useHarnessSettingsBridge.getState().owner !== owner) return;
    useHarnessSettingsBridge.setState({ owner: null, context: null });
  };
}
