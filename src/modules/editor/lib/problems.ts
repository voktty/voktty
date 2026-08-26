export const MAX_PROBLEMS_PER_DOCUMENT = 1_000;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_METADATA_LENGTH = 120;

export type ProblemSeverity = "error" | "warning" | "information" | "hint";

export type IdeProblem = {
  id: string;
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: ProblemSeverity;
  message: string;
  source: string | null;
  code: string | null;
};

export type ProblemDocument = {
  owner: string;
  root: string;
  path: string;
  problems: IdeProblem[];
};

export type ProblemSummary = {
  errors: number;
  warnings: number;
  information: number;
  hints: number;
  total: number;
};

type LspPosition = { line: number; character: number };

export type RawLspDiagnostic = {
  range: { start: LspPosition; end: LspPosition };
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
};

function isPosition(value: unknown): value is LspPosition {
  if (typeof value !== "object" || value === null) return false;
  const position = value as Partial<LspPosition>;
  return (
    Number.isInteger(position.line) &&
    Number.isInteger(position.character) &&
    (position.line ?? -1) >= 0 &&
    (position.character ?? -1) >= 0
  );
}

function isRawDiagnostic(value: unknown): value is RawLspDiagnostic {
  if (typeof value !== "object" || value === null) return false;
  const diagnostic = value as Partial<RawLspDiagnostic>;
  return (
    typeof diagnostic.message === "string" &&
    typeof diagnostic.range === "object" &&
    diagnostic.range !== null &&
    isPosition(diagnostic.range.start) &&
    isPosition(diagnostic.range.end)
  );
}

function severityOf(value: number | undefined): ProblemSeverity {
  if (value === 1) return "error";
  if (value === 2) return "warning";
  if (value === 4) return "hint";
  return "information";
}

function boundedMetadata(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value).slice(0, MAX_METADATA_LENGTH);
}

export function normalizeLspDiagnostics(
  path: string,
  diagnostics: readonly unknown[],
): IdeProblem[] {
  const normalized: IdeProblem[] = [];
  for (const candidate of diagnostics) {
    if (normalized.length >= MAX_PROBLEMS_PER_DOCUMENT) break;
    if (!isRawDiagnostic(candidate)) continue;
    const { start, end } = candidate.range;
    if (
      end.line < start.line ||
      (end.line === start.line && end.character < start.character)
    ) {
      continue;
    }
    const message = candidate.message.slice(0, MAX_MESSAGE_LENGTH);
    const source = boundedMetadata(candidate.source);
    const code = boundedMetadata(candidate.code);
    const severity = severityOf(candidate.severity);
    const line = start.line + 1;
    const column = start.character + 1;
    const endLine = end.line + 1;
    const endColumn = end.character + 1;
    normalized.push({
      id: [
        path,
        line,
        column,
        endLine,
        endColumn,
        severity,
        source ?? "",
        code ?? "",
        message,
      ].join("\u0000"),
      path,
      line,
      column,
      endLine,
      endColumn,
      severity,
      message,
      source,
      code,
    });
  }
  return normalized;
}

function canonicalPath(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function isPathInside(path: string, root: string): boolean {
  const normalizedPath = canonicalPath(path);
  const normalizedRoot = canonicalPath(root);
  if (!normalizedRoot) return false;
  if (normalizedRoot === "/") return normalizedPath.startsWith("/");
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

const SEVERITY_ORDER: Record<ProblemSeverity, number> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
};

export function collectWorkspaceProblems(
  documents: Readonly<Record<string, ProblemDocument>>,
  root: string | null,
): IdeProblem[] {
  if (!root) return [];
  const byId = new Map<string, IdeProblem>();
  for (const document of Object.values(documents)) {
    if (!isPathInside(document.path, root)) continue;
    for (const problem of document.problems) byId.set(problem.id, problem);
  }
  return [...byId.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      canonicalPath(a.path).localeCompare(canonicalPath(b.path)) ||
      a.line - b.line ||
      a.column - b.column ||
      a.message.localeCompare(b.message),
  );
}

export function summarizeProblems(
  problems: readonly IdeProblem[],
): ProblemSummary {
  const summary: ProblemSummary = {
    errors: 0,
    warnings: 0,
    information: 0,
    hints: 0,
    total: problems.length,
  };
  for (const problem of problems) {
    if (problem.severity === "error") summary.errors += 1;
    else if (problem.severity === "warning") summary.warnings += 1;
    else if (problem.severity === "information") summary.information += 1;
    else summary.hints += 1;
  }
  return summary;
}
