import type { HarnessWindowViewCohort } from "@/modules/harness/lib/harnessWindowViews";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import {
  closeLeaf,
  leafIds,
  type WorkspaceTab,
} from "@/modules/harness/lib/layout";
import { removeSessionDocuments } from "@/modules/harness/lib/sessionWorkspaceLifecycle";

export function removeRetainedSessionReferences(
  state: HarnessWindowViewCohort["state"],
  sessionIds: readonly string[],
): HarnessWindowViewCohort["state"] | null {
  const ids = new Set(
    normalizeHarnessSessionViewReport({ referencedSessionIds: sessionIds })
      .referencedSessionIds,
  );
  const tabs: WorkspaceTab[] = [];
  for (const original of state.layout.tabs) {
    if (
      [...original.editorPanes, ...original.terminalPanes].some(
        (pane) =>
          ids.has(pane.id) &&
          pane.files.some(
            (file) =>
              !ids.has(file.plan?.sessionId ?? "") &&
              !ids.has(file.sessionChanges?.sessionId ?? ""),
          ),
      )
    )
      return null;
    let tab: WorkspaceTab | null = original;
    for (const id of ids) {
      if (!tab) break;
      const cleaned = removeSessionDocuments(tab, id);
      if (
        !cleaned &&
        [...tab.editorPanes, ...tab.terminalPanes].some((pane) =>
          pane.files.some(
            (file) =>
              !ids.has(file.plan?.sessionId ?? "") &&
              !ids.has(file.sessionChanges?.sessionId ?? ""),
          ),
        )
      )
        return null;
      tab = cleaned;
      if (!tab || !leafIds(tab.layout).includes(id)) continue;
      const next = closeLeaf(tab, id);
      if (
        !next &&
        [...tab.editorPanes, ...tab.terminalPanes].some(
          (pane) => pane.files.length > 0,
        )
      )
        return null;
      tab = next;
    }
    if (tab) tabs.push(tab);
  }
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const paneIds = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
  const removedTargets = new Set(
    state.layout.tabs.flatMap((tab) => [
      ...(!tabIds.has(tab.id) ? [tab.id] : []),
      ...leafIds(tab.layout).filter((id) => !paneIds.has(id)),
    ]),
  );
  const keep = (id: string) => !ids.has(id);
  return {
    ...state,
    layout: {
      ...state.layout,
      tabs,
      sessions: state.layout.sessions.filter((session) => keep(session.id)),
      activeTabId: tabIds.has(state.layout.activeTabId)
        ? state.layout.activeTabId
        : (tabs[0]?.id ?? ""),
      projectReturnTargets: state.layout.projectReturnTargets?.filter(
        (target) =>
          !ids.has(target.paneId ?? target.tabId ?? "") &&
          !removedTargets.has(target.paneId ?? target.tabId ?? ""),
      ),
    },
    returnTargets: state.returnTargets.filter(
      ([, id]) => keep(id) && !removedTargets.has(id),
    ),
    keptTabIds: state.keptTabIds.filter((id) => tabIds.has(id)),
    report: normalizeHarnessSessionViewReport({
      referencedSessionIds: state.report.referencedSessionIds.filter(keep),
      foregroundSessionIds: state.report.foregroundSessionIds.filter(keep),
      activeSessionId:
        state.report.activeSessionId && keep(state.report.activeSessionId)
          ? state.report.activeSessionId
          : null,
    }),
    removingSessionIds: state.removingSessionIds.filter(keep),
    switchingSessionIds: state.switchingSessionIds.filter(keep),
  };
}
