import { isTabKey } from "@/modules/tabs/lib/tabIdentity";
import { MAX_HARNESS_WINDOW_STATE, type HarnessWindowState } from "@/modules/lifecycle/windowSessionState";
import { leafIds } from "@/modules/harness/lib/layout";
import type { Session } from "@/modules/harness/lib/session";
import { captureHarnessWindowSnapshot, type HarnessWindowViewsSnapshot } from "@/modules/harness/lib/harnessWindowViews";
import { collectWorkspaceSnapshot, parseWorkspaceSnapshot, type WorkspaceSnapshot } from "@/modules/harness/lib/workspaceSnapshot";
import { mergeHarnessWindowWorkspaces } from "@/modules/harness/lib/harnessWindowWorkspace";

export type HarnessWindowSnapshot = {
  workspace: WorkspaceSnapshot;
  views: { tabKey: string | null; workspace: WorkspaceSnapshot }[];
};

export function collectHarnessWindowState(
  views: HarnessWindowViewsSnapshot,
  sessions: Session[],
  keys: ReadonlyMap<number, string>,
): HarnessWindowState {
  const captured = captureHarnessWindowSnapshot(views, sessions);
  const workspace = collectWorkspaceSnapshot(captured.tabs, sessions, captured.activeTabId,
    captured.projectCwd, captured.projectReturnMemory, captured.projectTerminals, captured.keepTab);
  const value: HarnessWindowSnapshot = {
    workspace,
    views: views.cohorts.map((cohort) => {
      const { layout, returnTargets, report, keptTabIds } = cohort.state;
      const ids = new Set([...report.referencedSessionIds, ...layout.tabs.flatMap((tab) => leafIds(tab.layout))]);
      return {
        tabKey: keys.get(cohort.ownerId) ?? null,
        workspace: collectWorkspaceSnapshot(layout.tabs, sessions.filter((session) => ids.has(session.id)),
          layout.activeTabId, layout.projectCwd, new Map(returnTargets), layout.projectTerminals,
          (tab) => keptTabIds.includes(tab.id)),
      };
    }),
  };
  const payload = JSON.stringify(value);
  if (payload.length > MAX_HARNESS_WINDOW_STATE) throw new Error("Harness window snapshot capacity exceeded.");
  return { version: 1, payload };
}

function boundedTree(value: unknown): boolean {
  const pending: [unknown, number][] = [[value, 0]];
  let count = 0;
  while (pending.length) {
    const [current, depth] = pending.pop()!;
    if (++count > 32768 || depth > 64) return false;
    if (current && typeof current === "object") {
      const children = Object.values(current);
      if (children.length > 1024) return false;
      for (const child of children) pending.push([child, depth + 1]);
    }
  }
  return true;
}

export function parseHarnessWindowSnapshot(state: HarnessWindowState): HarnessWindowSnapshot {
  if (state.payload.length > MAX_HARNESS_WINDOW_STATE) throw new Error("Harness window snapshot capacity exceeded.");
  const value: unknown = JSON.parse(state.payload);
  if (!value || typeof value !== "object" || !boundedTree(value)) throw new Error("Invalid Harness window snapshot.");
  const raw = value as { workspace?: unknown; views?: unknown };
  const workspace = parseWorkspaceSnapshot(raw.workspace, true);
  if (!workspace || !Array.isArray(raw.views) || raw.views.length > 256) throw new Error("Invalid Harness window snapshot.");
  const keys = new Set<string>();
  const views = raw.views.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid Harness view snapshot.");
    const candidate = entry as { tabKey?: unknown; workspace?: unknown };
    const tabKey = candidate.tabKey;
    if (tabKey !== null && (!isTabKey(tabKey) || tabKey.length > 256 || keys.has(tabKey))) throw new Error("Invalid Harness view identity.");
    if (tabKey !== null) keys.add(tabKey);
    const view = parseWorkspaceSnapshot(candidate.workspace, true);
    if (!view) throw new Error("Invalid Harness view snapshot.");
    mergeHarnessWindowWorkspaces([{ ownerId: 1, sessions: [], snapshot: view }], null);
    return { tabKey, workspace: view };
  });
  mergeHarnessWindowWorkspaces([{ ownerId: 1, sessions: [], snapshot: workspace }], null);
  return { workspace, views };
}
