import type { FilePaneTab, WorkspaceTab } from "@/modules/harness/lib/layout";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";

export type LegacyTerminalMapping = Readonly<{
  source: Readonly<FilePaneTab>;
  reference: NonNullable<FilePaneTab["canonicalTerminal"]>;
}>;

export function sameLegacyTerminal(a: FilePaneTab, b: FilePaneTab) {
  return (
    a.id === b.id &&
    a.cwd === b.cwd &&
    a.path === b.path &&
    a.terminal === true &&
    b.terminal === true &&
    !a.plan &&
    !b.plan &&
    !a.review &&
    !b.review &&
    !a.changes &&
    !b.changes &&
    !a.releaseNotes &&
    !b.releaseNotes &&
    !a.sessionChanges &&
    !b.sessionChanges
  );
}

export function mapLegacyTerminalLayout(
  tabs: WorkspaceTab[],
  docks: ProjectTerminalDock[],
  mappings: ReadonlyMap<string, LegacyTerminalMapping>,
) {
  const mapFile = (file: FilePaneTab) => {
    const mapping = mappings.get(file.id);
    if (!mapping) return file;
    if (
      file.canonicalTerminal?.tabKey === mapping.reference.tabKey &&
      file.canonicalTerminal.projectCwd === mapping.reference.projectCwd
    )
      return file;
    if (!sameLegacyTerminal(file, mapping.source))
      throw new Error("Conflicting legacy terminal definition.");
    const { foreground: _foreground, ...rest } = file;
    return { ...rest, canonicalTerminal: mapping.reference };
  };
  const mapPane = (pane: WorkspaceTab["editorPanes"][number]) => {
    const files = pane.files.map(mapFile);
    return files.some((file, index) => file !== pane.files[index])
      ? { ...pane, files }
      : pane;
  };
  const nextTabs = tabs.map((tab) => {
    const editorPanes = tab.editorPanes.map(mapPane);
    const terminalPanes = tab.terminalPanes.map(mapPane);
    return editorPanes.some((pane, index) => pane !== tab.editorPanes[index]) ||
      terminalPanes.some((pane, index) => pane !== tab.terminalPanes[index])
      ? { ...tab, editorPanes, terminalPanes }
      : tab;
  });
  const nextDocks = docks.map((dock) => {
    const pane = mapPane(dock.pane);
    return pane === dock.pane ? dock : { ...dock, pane };
  });
  return {
    tabs: nextTabs.some((tab, index) => tab !== tabs[index]) ? nextTabs : tabs,
    docks: nextDocks.some((dock, index) => dock !== docks[index])
      ? nextDocks
      : docks,
  };
}
