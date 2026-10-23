import type { FilePaneTab, WorkspaceTab } from "@/modules/harness/lib/layout";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";
import { normalizeProjectPath } from "@/modules/harness/lib/recents";

export type TerminalRecoveryState = {
  projectCwd: string;
  activeTabId: string;
  tabs: WorkspaceTab[];
  docks: ProjectTerminalDock[];
};
export type TerminalRecoveryTarget = {
  slotKey: string;
  file: FilePaneTab;
  tabId?: string;
  paneId: string;
  dockProject?: string;
};

export function terminalRecoveryTarget(
  state: TerminalRecoveryState,
  fileId: string,
  slotKey: string,
  legacy = false,
): TerminalRecoveryTarget | undefined {
  for (const dock of state.docks) {
    if (
      slotKey !== `dock:${normalizeProjectPath(dock.projectPath)}` ||
      normalizeProjectPath(dock.projectPath) !==
        normalizeProjectPath(state.projectCwd) ||
      !dock.open ||
      dock.pane.activeFileId !== fileId
    )
      continue;
    const file = dock.pane.files.find((file) => file.id === fileId);
    if (
      file?.terminal &&
      (legacy
        ? !file.canonicalTerminal
        : file.canonicalTerminal?.projectCwd === state.projectCwd)
    )
      return {
        slotKey,
        file,
        paneId: dock.pane.id,
        dockProject: dock.projectPath,
      };
  }
  const tab = state.tabs.find((tab) => tab.id === state.activeTabId);
  for (const pane of [
    ...(tab?.editorPanes ?? []),
    ...(tab?.terminalPanes ?? []),
  ]) {
    if (slotKey !== `pane:${pane.id}` || pane.activeFileId !== fileId) continue;
    const file = pane.files.find((file) => file.id === fileId);
    if (
      file?.terminal &&
      (legacy
        ? !file.canonicalTerminal
        : file.canonicalTerminal?.projectCwd === state.projectCwd)
    )
      return { slotKey, file, paneId: pane.id, tabId: tab?.id };
  }
  return undefined;
}

export function replaceRecoveredTerminalTabs(
  tabs: WorkspaceTab[],
  target: TerminalRecoveryTarget,
  replacement: FilePaneTab,
) {
  if (!target.tabId) return tabs;
  let changed = false;
  const next = tabs.map((tab) => {
    if (tab.id !== target.tabId) return tab;
    const update = (panes: WorkspaceTab["editorPanes"]) =>
      panes.map((pane) => {
        if (
          pane.id !== target.paneId ||
          pane.activeFileId !== target.file.id ||
          !pane.files.includes(target.file)
        )
          return pane;
        changed = true;
        return {
          ...pane,
          files: pane.files.map((file) =>
            file === target.file ? replacement : file,
          ),
        };
      });
    const editorPanes = update(tab.editorPanes);
    const terminalPanes = update(tab.terminalPanes);
    return changed ? { ...tab, editorPanes, terminalPanes } : tab;
  });
  return changed ? next : tabs;
}

export function replaceRecoveredTerminalDocks(
  docks: ProjectTerminalDock[],
  target: TerminalRecoveryTarget,
  replacement: FilePaneTab,
) {
  if (!target.dockProject) return docks;
  let changed = false;
  const next = docks.map((dock) => {
    if (
      dock.projectPath !== target.dockProject ||
      dock.pane.id !== target.paneId ||
      !dock.open ||
      dock.pane.activeFileId !== target.file.id ||
      !dock.pane.files.includes(target.file)
    )
      return dock;
    changed = true;
    return {
      ...dock,
      pane: {
        ...dock.pane,
        files: dock.pane.files.map((file) =>
          file === target.file ? replacement : file,
        ),
      },
    };
  });
  return changed ? next : docks;
}
