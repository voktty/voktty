import type { ProblemSeverity } from "@/modules/editor/lib/problems";
import { checkReadable, checkWorkspacePath } from "./security";

export const DEVELOPMENT_CONTEXT_LIMITS = {
  buffers: 8,
  excerptChars: 8_000,
  totalExcerptChars: 40_000,
  symbolsPerBuffer: 80,
  diagnostics: 100,
  diagnosticMessageChars: 500,
  gitFiles: 100,
  terminalChars: 8_000,
  checks: 12,
} as const;

export type DevelopmentSymbol = {
  name: string;
  kind: string | number;
  line: number;
};

export type DevelopmentBuffer = {
  path: string;
  language: string;
  dirty: boolean;
  cursor: { line: number; column: number };
  excerpt: string;
  symbols: DevelopmentSymbol[];
};

export type DevelopmentDiagnostic = {
  path: string;
  severity: ProblemSeverity;
  message: string;
  line: number;
  column: number;
};

export type DevelopmentGitContext = {
  branch: string;
  changedFiles: { path: string; status: string }[];
};

export type DevelopmentContextInput = {
  workspaceRoot: string | null;
  activeFile: string | null;
  buffers: DevelopmentBuffer[];
  diagnostics: DevelopmentDiagnostic[];
  git: DevelopmentGitContext | null;
  terminal: string | null;
  checks: string[];
};

export type DevelopmentContext = DevelopmentContextInput & {
  truncated: boolean;
};

function allowed(path: string, root: string | null): boolean {
  return checkReadable(path).ok && checkWorkspacePath(path, root).ok;
}

export function buildDevelopmentContext(
  input: DevelopmentContextInput,
): DevelopmentContext {
  const limits = DEVELOPMENT_CONTEXT_LIMITS;
  const workspaceRoot = input.workspaceRoot;
  let truncated = false;
  let excerptBudget = limits.totalExcerptChars;
  const eligibleBuffers = input.workspaceRoot
    ? input.buffers.filter((buffer) =>
        allowed(buffer.path, input.workspaceRoot),
      )
    : [];
  if (eligibleBuffers.length !== input.buffers.length) truncated = true;
  const buffers = eligibleBuffers.slice(0, limits.buffers).map((buffer) => {
    const excerptLength = Math.min(
      buffer.excerpt.length,
      limits.excerptChars,
      excerptBudget,
    );
    const symbols = buffer.symbols.slice(0, limits.symbolsPerBuffer);
    if (
      excerptLength < buffer.excerpt.length ||
      symbols.length < buffer.symbols.length
    ) {
      truncated = true;
    }
    excerptBudget -= excerptLength;
    return {
      ...buffer,
      excerpt: buffer.excerpt.slice(0, excerptLength),
      symbols: symbols.map((symbol) => ({
        ...symbol,
        name: symbol.name.slice(0, 256),
        kind:
          typeof symbol.kind === "string" ? symbol.kind.slice(0, 64) : symbol.kind,
      })),
    };
  });
  if (eligibleBuffers.length > buffers.length) truncated = true;

  const eligibleDiagnostics = input.workspaceRoot
    ? input.diagnostics.filter((problem) =>
        allowed(problem.path, input.workspaceRoot),
      )
    : [];
  const diagnostics = eligibleDiagnostics
    .slice(0, limits.diagnostics)
    .map((problem) => {
      if (problem.message.length > limits.diagnosticMessageChars)
        truncated = true;
      return {
        ...problem,
        message: problem.message.slice(0, limits.diagnosticMessageChars),
      };
    });
  if (eligibleDiagnostics.length !== diagnostics.length) truncated = true;

  const gitFiles =
    workspaceRoot && input.git
      ? input.git.changedFiles.filter((file) => {
          const separator = workspaceRoot.includes("\\") ? "\\" : "/";
          const path = `${workspaceRoot}${workspaceRoot.endsWith(separator) ? "" : separator}${file.path}`;
          return allowed(path, workspaceRoot);
        })
      : [];
  const git =
    input.workspaceRoot && input.git
      ? {
          branch: input.git.branch.slice(0, 256),
          changedFiles: gitFiles.slice(0, limits.gitFiles).map((file) => ({
            path: file.path.slice(0, 2_048),
            status: file.status.slice(0, 32),
          })),
        }
      : null;
  if (
    input.git &&
    git &&
    input.git.changedFiles.length > git.changedFiles.length
  ) {
    truncated = true;
  }
  const terminal = input.terminal?.slice(-limits.terminalChars) ?? null;
  if (input.terminal && terminal && terminal.length < input.terminal.length) {
    truncated = true;
  }
  const checks = input.checks
    .slice(0, limits.checks)
    .map((command) => command.slice(0, 500));
  if (checks.length < input.checks.length) truncated = true;

  return {
    workspaceRoot: input.workspaceRoot,
    activeFile:
      input.activeFile && allowed(input.activeFile, input.workspaceRoot)
        ? input.activeFile
        : null,
    buffers,
    diagnostics,
    git,
    terminal,
    checks,
    truncated,
  };
}
