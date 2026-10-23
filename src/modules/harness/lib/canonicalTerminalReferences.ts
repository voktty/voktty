import {
  closeLeaf,
  type EditorPane,
  type FilePaneTab,
  type WorkspaceTab,
} from "@/modules/harness/lib/layout";
import {
  closeTerminalInDock,
  type ProjectTerminalDock,
} from "@/modules/harness/lib/projectTerminal";

type Reference = NonNullable<FilePaneTab["canonicalTerminal"]>;
export type ClosedCanonicalFiles = ReadonlyMap<string, Reference>;

function closed(file: FilePaneTab, files: ClosedCanonicalFiles) {
  const reference = files.get(file.id);
  return Boolean(
    file.terminal &&
      reference &&
      file.canonicalTerminal?.tabKey === reference.tabKey &&
      file.canonicalTerminal.projectCwd === reference.projectCwd,
  );
}

function prunePane(
  pane: EditorPane,
  removed: ClosedCanonicalFiles,
): EditorPane | null {
  const files = pane.files.filter((file) => !closed(file, removed));
  if (files.length === pane.files.length) return pane;
  if (!files.length) return null;
  const index = pane.files.findIndex((file) => file.id === pane.activeFileId);
  const activeFileId = files.some((file) => file.id === pane.activeFileId)
    ? pane.activeFileId
    : files[Math.min(Math.max(0, index), files.length - 1)].id;
  return { ...pane, files, activeFileId };
}

export function pruneCanonicalTerminalTabs(
  tabs: WorkspaceTab[],
  removed: ClosedCanonicalFiles,
): WorkspaceTab[] {
  if (!removed.size) return tabs;
  let changed = false;
  const next = tabs.flatMap((original) => {
    let tab: WorkspaceTab | null = original;
    for (const kind of ["editorPanes", "terminalPanes"] as const) {
      const panes: EditorPane[] = [];
      for (const pane of original[kind]) {
        const updated = prunePane(pane, removed);
        if (updated) panes.push(updated);
        else if (tab) tab = closeLeaf(tab, pane.id);
        if (updated !== pane) changed = true;
      }
      if (
        tab &&
        (panes.some((pane, index) => pane !== original[kind][index]) ||
          panes.length !== original[kind].length)
      )
        tab = { ...tab, [kind]: panes };
    }
    return tab ? [tab] : [];
  });
  return changed ? next : tabs;
}

export function pruneCanonicalTerminalDocks(
  docks: ProjectTerminalDock[],
  removed: ClosedCanonicalFiles,
): ProjectTerminalDock[] {
  if (!removed.size) return docks;
  const next = docks.flatMap((original) => {
    let dock: ProjectTerminalDock | null = original;
    for (const file of original.pane.files)
      if (dock && closed(file, removed))
        dock = closeTerminalInDock(dock, file.id);
    return dock ? [dock] : [];
  });
  return next.length === docks.length &&
    next.every((dock, index) => dock === docks[index])
    ? docks
    : next;
}

export function canonicalPruneSelection(
  previous: WorkspaceTab[],
  next: WorkspaceTab[],
  activeId: string,
): string {
  if (next.some((tab) => tab.id === activeId)) return activeId;
  const index = Math.max(
    0,
    previous.findIndex((tab) => tab.id === activeId),
  );
  return next[Math.min(index, next.length - 1)]?.id ?? "";
}
