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

export type HarnessOpenSnapshotInput = {
  /** Cost of the dynamic import: fetch plus evaluate. */
  load?: number;
  /** Cost of turning the loaded component into a first frame. */
  render?: number;
  /** Cost of the first effects: IPC and database bound, not module bound. */
  ready?: number;
  complete: boolean;
};

export type PerfSnapshotInput = {
  terminal: TerminalSnapshotInput;
  editor: EditorSnapshotInput;
  lsp: LspSnapshotInput;
  harnessOpen?: HarnessOpenSnapshotInput | null;
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
    ...harnessOpenLines(input.harnessOpen),
    `[js heap]            ${formatBytes(terminal.jsHeapBytes)}`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value} ms`;
}

/** Omitted until the harness has been opened once, so it cannot read as 0. */
function harnessOpenLines(
  timing: HarnessOpenSnapshotInput | null | undefined,
): string[] {
  if (!timing) return [];
  return [
    "[harness first open]",
    `  load (fetch+eval): ${formatMs(timing.load)}`,
    `  render:            ${formatMs(timing.render)}`,
    `  ready (effects):   ${formatMs(timing.ready)}`,
    timing.complete ? "" : "  (still opening)",
  ].filter((line) => line !== "");
}
