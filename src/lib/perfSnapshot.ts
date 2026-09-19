/**
 * Formats the renderer-retention counters into text a user can copy out of a
 * release build.
 *
 * Production has no console: devtools are not compiled in, and the webview's
 * inspect shortcuts and context menu are suppressed. Without this the counters
 * that decide the editor ownership model could only be read from a dev build,
 * whose memory profile is not the one being asked about.
 */

export type TerminalSnapshotInput = {
  poolSize: number;
  webglContexts: number;
  idleSlots: number;
  sessionCount: number;
  ringBytesTotal: number;
  snapshotCharsTotal: number;
  domCanvases: number;
  jsHeapBytes: number | null;
};

export type EditorSnapshotInput = {
  mountedPanes: number;
  visiblePanes: number;
  dirtyPanes: number;
  documentBytes: number;
  largestDocumentBytes: number;
  domEditors: number;
};

export type LspSnapshotInput = {
  sessions: number;
  totalDocuments: number;
  totalRefs: number;
};

export type PerfSnapshotInput = {
  terminal: TerminalSnapshotInput;
  editor: EditorSnapshotInput;
  lsp: LspSnapshotInput;
  appVersion?: string;
  platform?: string;
};

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "n/a";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatPerfSnapshot(input: PerfSnapshotInput): string {
  const { terminal, editor, lsp } = input;
  const lines = [
    "voktty renderer retention snapshot",
    input.appVersion ? `version: ${input.appVersion}` : null,
    input.platform ? `platform: ${input.platform}` : null,
    "",
    "[terminal]",
    `  live sessions:     ${terminal.sessionCount}`,
    `  pool slots:        ${terminal.poolSize} (${terminal.idleSlots} idle)`,
    `  webgl contexts:    ${terminal.webglContexts}`,
    `  dom canvases:      ${terminal.domCanvases}`,
    `  dormant rings:     ${formatBytes(terminal.ringBytesTotal)}`,
    `  stored snapshots:  ${formatBytes(terminal.snapshotCharsTotal)}`,
    "",
    "[editor]",
    `  mounted panes:     ${editor.mountedPanes} (${editor.visiblePanes} visible, ${editor.dirtyPanes} dirty)`,
    `  dom editors:       ${editor.domEditors}`,
    `  document text:     ${formatBytes(editor.documentBytes)}`,
    `  largest document:  ${formatBytes(editor.largestDocumentBytes)}`,
    "",
    "[lsp]",
    `  sessions:          ${lsp.sessions}`,
    `  documents:         ${lsp.totalDocuments}`,
    `  references:        ${lsp.totalRefs}`,
    "",
    `[js heap]            ${formatBytes(terminal.jsHeapBytes)}`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}
