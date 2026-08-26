import {
  modelSupportsTemperature,
  providerNeedsKey,
  resolveModel,
} from "@/modules/ai/config";
import {
  type GitChangedFile,
  type GitDiscardEntry,
  type GitRepoInfo,
  type GitStatusSnapshot,
  native,
} from "@/modules/ai/lib/native";
import { isAiRuntimeAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  invalidateDiff,
  invalidateRepoDiffs,
  workingDiffKey,
} from "@/modules/editor/lib/diffCache";
import { useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { playVokttySound } from "@/modules/sound";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGitReviewEntries,
  type GitReviewCheckState,
  type GitReviewEntry,
  gitStatusCodeForMode,
  isGitReviewEntryDirty,
} from "./lib/reviewQueue";
import {
  generateSemanticStagingGroups,
  type SemanticCommitGroup,
} from "./lib/semanticStaging";
import type { SourceControlSummary } from "./useSourceControl";

export type { SemanticCommitGroup };

type PanelState =
  | "closed"
  | "loading"
  | "no-repo"
  | "ready"
  | "error"
  | "dubious-ownership";
type DiffMode = "+" | "-";
type SelectionTransition = "none" | "moved-group" | "reset";

export const COMMIT_MESSAGE_LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish (Español)",
  pt: "Portuguese (Português)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  it: "Italian (Italiano)",
  zh: "Simplified Chinese (简体中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  ru: "Russian (Русский)",
};

const COMMIT_DIFF_CHAR_LIMIT = 12_000;
const COMMIT_MESSAGE_MAX_OUTPUT_TOKENS = 256;
const RECONCILE_DEBOUNCE_MS = 180;
const CONVENTIONAL_PREFIX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/i;

const LARGE_DIFF_FILE_PATTERNS = [
  /\.lock$/i,
  /-lock\./i,
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /\.svg$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.ico$/i,
  /\.wasm$/i,
  /\.bin$/i,
];

export function getCommitMessageSystemPrompt(
  targetLanguageName?: string,
): string {
  if (targetLanguageName) {
    return `You write concise Conventional Commit subject lines with descriptions in ${targetLanguageName}. Return exactly one complete line, with no markdown, no quotes, no body, and no explanation.`;
  }
  return "You write concise Conventional Commit subject lines in English. Return exactly one complete line, with no markdown, no quotes, no body, and no explanation.";
}

export type DiffSelection = {
  path: string;
  mode: DiffMode;
};

export type SourceControlEntry = {
  key: string;
  path: string;
  mode: DiffMode;
  indexStatus: string;
  worktreeStatus: string;
  statusLabel: string;
  statusCode: string;
  originalPath: string | null;
  untracked: boolean;
};

export type CheckState = GitReviewCheckState;

/** One row per changed file (flat list), merging the staged/unstaged split. */
export type SourceControlFileEntry = GitReviewEntry;

export type PendingDiscard = {
  scope: "single" | "all";
  count: number;
  label: string;
};

type SourceControlPanelState = {
  panelState: PanelState;
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  selected: DiffSelection | null;
  commitMessage: string;
  actionBusy: string | null;
  statusError: string | null;
  dubiousOwnershipPath: string | null;
  actionError: string | null;
  remoteError: string | null;
  actionMessage: string | null;
  stagedEntries: SourceControlEntry[];
  unstagedEntries: SourceControlEntry[];
  fileEntries: SourceControlFileEntry[];
  headerCheckState: CheckState;
  allClean: boolean;
  canPush: boolean;
  pushHint: string | null;
  canGenerateCommitMessage: boolean;
  generateCommitMessageHint: string;
  selectionTransition: SelectionTransition;
  stagedEmptyText: string;
  unstagedEmptyText: string;
  pendingDiscard: PendingDiscard | null;
  semanticGroups: SemanticCommitGroup[];
  semanticStagingOpen: boolean;
  setSemanticStagingOpen: (open: boolean) => void;
  generateSemanticGroups: () => Promise<void>;
  applySemanticGroup: (group: SemanticCommitGroup) => Promise<void>;
  setCommitMessage: (value: string) => void;
  refresh: () => Promise<void>;
  trustRepository: (path?: string) => Promise<void>;
  initRepository: (path?: string) => Promise<void>;
  selectEntry: (entry: SourceControlEntry) => Promise<void>;
  selectFile: (entry: SourceControlFileEntry) => Promise<void>;
  stageEntry: (entry: SourceControlEntry) => Promise<void>;
  unstageEntry: (entry: SourceControlEntry) => Promise<void>;
  toggleStageFile: (entry: SourceControlFileEntry) => Promise<void>;
  toggleAll: () => Promise<void>;
  requestDiscardEntry: (entry: SourceControlEntry) => void;
  requestDiscardFile: (entry: SourceControlFileEntry) => void;
  requestDiscardAll: () => void;
  confirmPendingDiscard: () => Promise<void>;
  cancelPendingDiscard: () => void;
  stageAllEntries: () => Promise<void>;
  unstageAllEntries: () => Promise<void>;
  generateCommitMessage: () => Promise<void>;
  commit: () => Promise<void>;
  push: () => Promise<void>;
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown source control error";
}

function statusCodeForMode(mode: DiffMode, file: GitChangedFile): string {
  return gitStatusCodeForMode(mode, file);
}

function makeEntry(
  path: string,
  mode: DiffMode,
  file: GitChangedFile,
): SourceControlEntry {
  return {
    key: `${mode}:${path}`,
    path,
    mode,
    indexStatus: file.indexStatus,
    worktreeStatus: file.worktreeStatus,
    statusLabel: file.statusLabel,
    statusCode: statusCodeForMode(mode, file),
    originalPath: file.originalPath,
    untracked: file.untracked,
  };
}

function sameSelection(
  a: DiffSelection | null,
  b: DiffSelection | null,
): boolean {
  return !!a && !!b && a.path === b.path && a.mode === b.mode;
}

export type CommitCandidateEntry = {
  path: string;
  statusCode: string;
  originalPath?: string | null;
};

function stagedFilesSummary(entries: CommitCandidateEntry[]): string {
  return entries
    .map((entry) => {
      const status = entry.originalPath
        ? `R ${entry.originalPath} -> ${entry.path}`
        : `${entry.statusCode} ${entry.path}`;
      return `- ${status}`;
    })
    .join("\n");
}

export function truncateDiff(diff: string): {
  text: string;
  truncated: boolean;
} {
  if (!diff || diff.trim().length === 0) {
    return { text: "", truncated: false };
  }

  const fileDiffs = diff.split(/(?=diff --git )/);
  const sanitizedHunks: string[] = [];
  let totalChars = 0;
  let wasTruncated = false;

  for (const fileDiff of fileDiffs) {
    const firstLine = fileDiff.split("\n")[0] || "";
    const isLargeOrGenerated = LARGE_DIFF_FILE_PATTERNS.some((pattern) =>
      pattern.test(firstLine),
    );

    if (isLargeOrGenerated) {
      sanitizedHunks.push(
        `${firstLine}\n  [large or generated file omitted from diff analysis]\n`,
      );
      continue;
    }

    const lines = fileDiff.split("\n");
    const clampedLines = lines.slice(0, 40);
    if (lines.length > 40) {
      clampedLines.push("  ... [remaining file diff omitted]");
    }
    const hunkText = clampedLines.join("\n");

    if (totalChars + hunkText.length > COMMIT_DIFF_CHAR_LIMIT) {
      const remaining = COMMIT_DIFF_CHAR_LIMIT - totalChars;
      if (remaining > 100) {
        sanitizedHunks.push(hunkText.slice(0, remaining));
      }
      wasTruncated = true;
      break;
    }

    sanitizedHunks.push(hunkText);
    totalChars += hunkText.length;
  }

  return {
    text: sanitizedHunks.join("\n"),
    truncated: wasTruncated || diff.length > COMMIT_DIFF_CHAR_LIMIT,
  };
}

export function cleanCommitMessage(raw: string): string {
  let text = raw.trim();
  const fence = text.match(
    /^\`\`\`[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?\`\`\`\s*$/,
  );
  if (fence) text = fence[1].trim();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  let cleaned = firstLine.replace(/^[\"'`]+|[\"'`]+$/g, "").trim();
  cleaned = cleaned.replace(/^(commit message|subject|title):\s*/i, "").trim();
  cleaned = cleaned.replace(/^[\"'`]+|[\"'`]+$/g, "").trim();

  if (CONVENTIONAL_PREFIX.test(cleaned)) {
    return cleaned;
  }

  const typeMatch = cleaned.match(
    /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?[\s\-:]+(.+)$/i,
  );
  if (typeMatch) {
    const [, type, scope, subject] = typeMatch;
    return `${type.toLowerCase()}${scope || ""}: ${subject.trim()}`;
  }

  return `chore: ${cleaned}`;
}

export function isValidCommitMessage(message: string): boolean {
  return CONVENTIONAL_PREFIX.test(message) || message.trim().length > 0;
}

export function buildCommitMessagePrompt(
  entries: CommitCandidateEntry[],
  diffText: string,
  truncated: boolean,
  targetLanguageName?: string,
): string {
  const langRule = targetLanguageName
    ? `Write the commit subject/description in ${targetLanguageName}. Keep the conventional commit type and scope in standard lowercase English (e.g. feat(scope): <description in ${targetLanguageName}> or feat: <description in ${targetLanguageName}>).`
    : "Write the commit subject in English.";

  return [
    "Generate one concise Conventional Commit subject line for the changed files.",
    "Format: type(scope): subject",
    "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
    langRule,
    "Examples:",
    targetLanguageName
      ? "- feat: agregar soporte para nuevo protocolo\n- fix(git): corregir error al procesar diff\n- chore: actualizar dependencias"
      : "- feat(source-control): generate commit messages\n- fix(git): handle staged diff errors\n- chore: update project metadata",
    "Rules:",
    "1. Use a short subject in imperative mood.",
    "2. Return EXACTLY one single line.",
    "3. Do NOT include markdown code blocks, quotes, bodies, or explanations.",
    truncated
      ? "The diff below was summarized/truncated; infer intent from the changed files list and hunks."
      : "The changed diff is included below.",
    "",
    "Changed files:",
    stagedFilesSummary(entries),
    "",
    "Diff summary:",
    diffText || "(No textual diff available.)",
  ].join("\n");
}

function buildRepairCommitMessagePrompt(
  invalidMessage: string,
  entries: CommitCandidateEntry[],
): string {
  return [
    "Repair this invalid Conventional Commit subject line.",
    `Invalid line: ${invalidMessage || "(empty)"}`,
    "Return exactly one complete valid line in this format: type(scope): subject",
    "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
    "If the scope is unclear, omit it and use: type: subject",
    "",
    "Staged files:",
    stagedFilesSummary(entries),
  ].join("\n");
}

function optimisticStage(
  status: GitStatusSnapshot,
  paths: Set<string>,
): GitStatusSnapshot {
  let changed = false;
  const next = status.changedFiles.map((file) => {
    if (!paths.has(file.path)) return file;
    if (file.staged && !file.unstaged) return file;
    changed = true;
    const wt =
      file.worktreeStatus !== " " ? file.worktreeStatus : file.indexStatus;
    return {
      ...file,
      indexStatus: wt,
      worktreeStatus: " ",
      staged: true,
      unstaged: false,
      untracked: false,
    };
  });
  if (!changed) return status;
  return { ...status, changedFiles: next };
}

function optimisticUnstage(
  status: GitStatusSnapshot,
  paths: Set<string>,
): GitStatusSnapshot {
  let changed = false;
  const next: GitChangedFile[] = [];
  for (const file of status.changedFiles) {
    if (!paths.has(file.path)) {
      next.push(file);
      continue;
    }
    if (!file.staged && file.unstaged) {
      next.push(file);
      continue;
    }
    changed = true;
    const idx =
      file.indexStatus !== " " ? file.indexStatus : file.worktreeStatus;
    if (idx === "R" && file.originalPath) {
      next.push({
        path: file.originalPath,
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "D",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Deleted",
      });
      next.push({
        path: file.path,
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "?",
        staged: false,
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      });
      continue;
    }
    next.push({
      ...file,
      originalPath: null,
      indexStatus: " ",
      worktreeStatus: idx === "A" ? "?" : idx,
      staged: false,
      unstaged: true,
      untracked: idx === "A",
    });
  }
  if (!changed) return status;
  return { ...status, changedFiles: next };
}

function optimisticDiscard(
  status: GitStatusSnapshot,
  paths: Set<string>,
): GitStatusSnapshot {
  let changed = false;
  const next: GitChangedFile[] = [];
  for (const file of status.changedFiles) {
    if (!paths.has(file.path)) {
      next.push(file);
      continue;
    }
    if (file.staged) {
      changed = true;
      next.push({
        ...file,
        worktreeStatus: " ",
        unstaged: false,
        untracked: false,
      });
    } else {
      changed = true;
    }
  }
  if (!changed) return status;
  return { ...status, changedFiles: next };
}

export function useSourceControlPanel(
  isOpen: boolean,
  summary: SourceControlSummary,
  onOpenDiff:
    | ((input: {
        path: string;
        repoRoot: string;
        mode: DiffMode;
        originalPath: string | null;
        title?: string;
      }) => void)
    | null,
  dirtyPaths: readonly string[] = [],
): SourceControlPanelState {
  const selectedModelId = useChatStore((state) => state.selectedModelId);
  const agentStatus = useChatStore((state) => state.agentMeta.status);
  const hasApiKeyForSelected = useChatStore((state) => {
    const model = resolveModel(state.selectedModelId);
    return !providerNeedsKey(model.provider) || !!state.apiKeys[model.provider];
  });
  const lmstudioModelId = usePreferencesStore((state) => state.lmstudioModelId);
  const mlxModelId = usePreferencesStore((state) => state.mlxModelId);
  const ollamaModelId = usePreferencesStore((state) => state.ollamaModelId);
  const openaiCompatibleBaseURL = usePreferencesStore(
    (state) => state.openaiCompatibleBaseURL,
  );
  const openaiCompatibleModelId = usePreferencesStore(
    (state) => state.openaiCompatibleModelId,
  );
  const openrouterModelId = usePreferencesStore(
    (state) => state.openrouterModelId,
  );
  const { t } = useTranslation();
  const [panelState, setPanelState] = useState<PanelState>("closed");
  const [repo, setRepo] = useState<GitRepoInfo | null>(null);
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [selected, setSelected] = useState<DiffSelection | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [localActionBusy, setLocalActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectionTransition, setSelectionTransition] =
    useState<SelectionTransition>("none");
  const [pendingDiscard, setPendingDiscard] = useState<
    | { scope: "single"; entry: SourceControlEntry }
    | { scope: "all"; entries: SourceControlEntry[] }
    | null
  >(null);
  const [semanticGroups, setSemanticGroups] = useState<SemanticCommitGroup[]>(
    [],
  );
  const [semanticStagingOpen, setSemanticStagingOpen] = useState(false);
  const selectedRef = useRef<DiffSelection | null>(null);
  const reconcileTimerRef = useRef(0);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const stagedEntries = useMemo(
    () =>
      (status?.changedFiles ?? [])
        .filter((file) => file.staged)
        .map((file) => makeEntry(file.path, "+", file)),
    [status],
  );

  const unstagedEntries = useMemo(
    () =>
      (status?.changedFiles ?? [])
        .filter((file) => file.unstaged)
        .map((file) => makeEntry(file.path, "-", file)),
    [status],
  );

  const fileEntries = useMemo<SourceControlFileEntry[]>(
    () => buildGitReviewEntries(status?.changedFiles ?? []),
    [status],
  );

  const headerCheckState = useMemo<CheckState>(() => {
    if (fileEntries.length === 0) return "unchecked";
    const allChecked = fileEntries.every((e) => e.checkState === "checked");
    if (allChecked) return "checked";
    const anyStaged = fileEntries.some((e) => e.staged);
    return anyStaged ? "indeterminate" : "unchecked";
  }, [fileEntries]);

  const allClean = stagedEntries.length === 0 && unstagedEntries.length === 0;
  const canPush = !!status?.upstream && status.behind === 0;
  const selectedModel = resolveModel(selectedModelId);
  const selectedModelSupportsTemperature = modelSupportsTemperature(
    selectedModel.provider,
    selectedModel.id,
  );
  const aiBusy = agentStatus !== "idle" && agentStatus !== "error";
  const anyActionBusy = localActionBusy !== null || summary.busyAction !== null;
  const aiUnavailableReason = useMemo(() => {
    if (stagedEntries.length === 0 && fileEntries.length === 0) {
      return t("git.noChanges");
    }
    if (!hasApiKeyForSelected) {
      return t("settings.models.configurationRequired");
    }
    if (selectedModel.id === "lmstudio-local" && !lmstudioModelId.trim()) {
      return t("settings.models.configurationRequired");
    }
    if (selectedModel.id === "mlx-local" && !mlxModelId.trim()) {
      return t("settings.models.configurationRequired");
    }
    if (selectedModel.id === "ollama-local" && !ollamaModelId.trim()) {
      return t("settings.models.configurationRequired");
    }
    if (
      selectedModel.id === "openai-compatible-custom" &&
      (!openaiCompatibleBaseURL.trim() || !openaiCompatibleModelId.trim())
    ) {
      return t("settings.models.configurationRequired");
    }
    if (selectedModel.id === "openrouter-custom" && !openrouterModelId.trim()) {
      return t("settings.models.configurationRequired");
    }
    return null;
  }, [
    fileEntries.length,
    hasApiKeyForSelected,
    lmstudioModelId,
    mlxModelId,
    ollamaModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
    openrouterModelId,
    selectedModel,
    stagedEntries.length,
    t,
  ]);
  const canGenerateCommitMessage =
    (stagedEntries.length > 0 || fileEntries.length > 0) &&
    !anyActionBusy &&
    !aiBusy &&
    !!repo;
  const generateCommitMessageHint = aiUnavailableReason
    ? aiUnavailableReason
    : aiBusy
      ? t("git.waitAiAction")
      : t("git.generateCommitMsg");
  const pushHint = useMemo(() => {
    if (!status) return null;
    if (!status.upstream) {
      return t("git.configureBranchToPush");
    }
    if (status.behind > 0) {
      return t("git.pullBeforePush");
    }
    if (status.ahead === 0) {
      return t("git.noCommitsToPush", { upstream: status.upstream });
    }
    return t("git.pushesTo", { upstream: status.upstream });
  }, [status, t]);
  const stagedEmptyText = t("git.noStagedChanges");
  const unstagedEmptyText = t("git.noUnstagedChanges");

  const cancelReconcile = useCallback(() => {
    if (reconcileTimerRef.current) {
      window.clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = 0;
    }
  }, []);

  const scheduleReconcile = useCallback(() => {
    cancelReconcile();
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = 0;
      void summary.refresh({ remote: "never" });
    }, RECONCILE_DEBOUNCE_MS);
  }, [cancelReconcile, summary]);

  useEffect(() => () => cancelReconcile(), [cancelReconcile]);

  const openSelection = useCallback(
    (
      sel: DiffSelection,
      repoRoot: string,
      file: GitChangedFile | undefined,
    ) => {
      onOpenDiff?.({
        path: sel.path,
        repoRoot,
        mode: sel.mode,
        originalPath: file?.originalPath ?? null,
      });
    },
    [onOpenDiff],
  );

  const refresh = useCallback(async () => {
    if (!isOpen) {
      setPanelState("closed");
      setSelectionTransition("none");
      return;
    }
    if (summary.repo) invalidateRepoDiffs(summary.repo.repoRoot);
    await summary.refresh({ remote: "never" });
  }, [isOpen, summary]);

  useEffect(() => {
    if (!isOpen) {
      setPanelState("closed");
      setSelectionTransition("none");
      return;
    }
    if (summary.isLoading && !summary.hasRepo && !summary.status) {
      setPanelState("loading");
      return;
    }
    if (summary.dubiousOwnershipPath) {
      setRepo(null);
      setStatus(null);
      setSelected(null);
      setPanelState("dubious-ownership");
      setSelectionTransition("none");
      return;
    }
    if (summary.localError && !summary.status) {
      setRepo(summary.repo);
      setStatus(null);
      setSelected(null);
      setPanelState("error");
      setSelectionTransition("none");
      return;
    }
    if (!summary.hasRepo) {
      setRepo(null);
      setStatus(null);
      setSelected(null);
      setPanelState("no-repo");
      setSelectionTransition("none");
      return;
    }
    if (!summary.repo || !summary.status) {
      if (summary.isLoading) {
        setPanelState("loading");
      }
      return;
    }

    setRepo(summary.repo);
    setStatus(summary.status);
    setPanelState("ready");

    const current = selectedRef.current;
    const exists =
      !!current &&
      summary.status.changedFiles.some((file) => {
        if (file.path !== current.path) return false;
        return current.mode === "+" ? file.staged : file.unstaged;
      });

    if (!exists && current) {
      const samePathOtherMode = summary.status.changedFiles.find(
        (file) =>
          file.path === current.path &&
          (current.mode === "+" ? file.unstaged : file.staged),
      );
      if (samePathOtherMode) {
        const moved: DiffSelection = {
          path: samePathOtherMode.path,
          mode: current.mode === "+" ? "-" : "+",
        };
        setSelected(moved);
        setSelectionTransition("moved-group");
      } else {
        setSelected(null);
        setSelectionTransition("reset");
      }
    } else {
      setSelectionTransition("none");
    }
  }, [
    isOpen,
    summary.hasRepo,
    summary.isLoading,
    summary.localError,
    summary.repo,
    summary.status,
  ]);

  const selectEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const nextSelection: DiffSelection = {
        path: entry.path,
        mode: entry.mode,
      };
      if (sameSelection(selected, nextSelection)) {
        setActionError(null);
        setActionMessage(null);
        setSelectionTransition("none");
        return;
      }
      setSelected(nextSelection);
      setActionError(null);
      setActionMessage(null);
      setSelectionTransition("none");
      const file = status?.changedFiles.find((c) => c.path === entry.path);
      openSelection(nextSelection, repo.repoRoot, file);
    },
    [openSelection, repo, selected, status],
  );

  const runMutation = useCallback(
    async (
      busyKey: string,
      optimistic: ((status: GitStatusSnapshot) => GitStatusSnapshot) | null,
      ipc: () => Promise<void>,
      affected: string[],
    ) => {
      if (!repo || summary.busyAction) return;
      setLocalActionBusy(busyKey);
      setActionMessage(null);
      setActionError(null);
      if (optimistic) summary.applyStatus(optimistic);
      for (const path of affected) {
        invalidateDiff(workingDiffKey(repo.repoRoot, path, "+"));
        invalidateDiff(workingDiffKey(repo.repoRoot, path, "-"));
      }
      try {
        await ipc();
        scheduleReconcile();
      } catch (error) {
        setActionError(normalizeError(error));
        cancelReconcile();
        await summary.refresh({ remote: "never" }).catch(() => {});
      } finally {
        setLocalActionBusy(null);
      }
    },
    [cancelReconcile, repo, scheduleReconcile, summary],
  );

  const stageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const paths = new Set([entry.path]);
      await runMutation(
        `stage:${entry.path}`,
        (s) => optimisticStage(s, paths),
        () => native.gitStage(repo.repoRoot, [entry.path]),
        [entry.path],
      );
    },
    [repo, runMutation],
  );

  const unstageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const paths = new Set([entry.path]);
      await runMutation(
        `unstage:${entry.path}`,
        (s) => optimisticUnstage(s, paths),
        () => native.gitUnstage(repo.repoRoot, [entry.path]),
        [entry.path],
      );
    },
    [repo, runMutation],
  );

  const requestDiscardEntry = useCallback(
    (entry: SourceControlEntry) => {
      if (!repo || summary.busyAction) return;
      if (isGitReviewEntryDirty(repo.repoRoot, entry, dirtyPaths)) {
        setActionError(`${t("explorer.unsavedChanges")}: ${entry.path}`);
        return;
      }
      setPendingDiscard({ scope: "single", entry });
    },
    [dirtyPaths, repo, summary.busyAction, t],
  );

  const requestDiscardAll = useCallback(() => {
    if (!repo || summary.busyAction || unstagedEntries.length === 0) return;
    const dirtyEntry = unstagedEntries.find((entry) =>
      isGitReviewEntryDirty(repo.repoRoot, entry, dirtyPaths),
    );
    if (dirtyEntry) {
      setActionError(`${t("explorer.unsavedChanges")}: ${dirtyEntry.path}`);
      return;
    }
    setPendingDiscard({ scope: "all", entries: unstagedEntries });
  }, [dirtyPaths, repo, summary.busyAction, t, unstagedEntries]);

  const cancelPendingDiscard = useCallback(() => {
    setPendingDiscard(null);
  }, []);

  const confirmPendingDiscard = useCallback(async () => {
    if (!repo || !pendingDiscard) return;
    const list =
      pendingDiscard.scope === "single"
        ? [pendingDiscard.entry]
        : pendingDiscard.entries;
    setPendingDiscard(null);
    const dirtyEntry = list.find((entry) =>
      isGitReviewEntryDirty(repo.repoRoot, entry, dirtyPaths),
    );
    if (dirtyEntry) {
      setActionError(`${t("explorer.unsavedChanges")}: ${dirtyEntry.path}`);
      return;
    }
    const entries: GitDiscardEntry[] = list.map((entry) => ({
      path: entry.path,
      untracked: entry.untracked,
    }));
    const paths = new Set(list.map((entry) => entry.path));
    await runMutation(
      pendingDiscard.scope === "single"
        ? `discard:${list[0].path}`
        : "discard:all",
      (s) => optimisticDiscard(s, paths),
      () => native.gitDiscard(repo.repoRoot, entries),
      [...paths],
    );
  }, [dirtyPaths, pendingDiscard, repo, runMutation, t]);

  const stageAllEntries = useCallback(async () => {
    if (!repo || unstagedEntries.length === 0) return;
    const paths = new Set(unstagedEntries.map((entry) => entry.path));
    await runMutation(
      "stage:all",
      (s) => optimisticStage(s, paths),
      () => native.gitStage(repo.repoRoot, [...paths]),
      [...paths],
    );
  }, [repo, runMutation, unstagedEntries]);

  const unstageAllEntries = useCallback(async () => {
    if (!repo || stagedEntries.length === 0) return;
    const paths = new Set(stagedEntries.map((entry) => entry.path));
    await runMutation(
      "unstage:all",
      (s) => optimisticUnstage(s, paths),
      () => native.gitUnstage(repo.repoRoot, [...paths]),
      [...paths],
    );
  }, [repo, runMutation, stagedEntries]);

  const selectFile = useCallback(
    async (entry: SourceControlFileEntry) => {
      if (!repo) return;
      const mode: DiffMode = entry.unstaged ? "-" : "+";
      const nextSelection: DiffSelection = { path: entry.path, mode };
      if (sameSelection(selected, nextSelection)) {
        setActionError(null);
        setActionMessage(null);
        setSelectionTransition("none");
        return;
      }
      setSelected(nextSelection);
      setActionError(null);
      setActionMessage(null);
      setSelectionTransition("none");
      const file = status?.changedFiles.find((c) => c.path === entry.path);
      openSelection(nextSelection, repo.repoRoot, file);
    },
    [openSelection, repo, selected, status],
  );

  const toggleStageFile = useCallback(
    async (entry: SourceControlFileEntry) => {
      if (!repo) return;
      const paths = new Set([entry.path]);
      if (entry.checkState === "checked") {
        await runMutation(
          `unstage:${entry.path}`,
          (s) => optimisticUnstage(s, paths),
          () => native.gitUnstage(repo.repoRoot, [entry.path]),
          [entry.path],
        );
      } else {
        await runMutation(
          `stage:${entry.path}`,
          (s) => optimisticStage(s, paths),
          () => native.gitStage(repo.repoRoot, [entry.path]),
          [entry.path],
        );
      }
    },
    [repo, runMutation],
  );

  const toggleAll = useCallback(async () => {
    if (headerCheckState === "checked") await unstageAllEntries();
    else await stageAllEntries();
  }, [headerCheckState, stageAllEntries, unstageAllEntries]);

  const requestDiscardFile = useCallback(
    (entry: SourceControlFileEntry) => {
      if (!repo || summary.busyAction) return;
      if (isGitReviewEntryDirty(repo.repoRoot, entry, dirtyPaths)) {
        setActionError(`${t("explorer.unsavedChanges")}: ${entry.path}`);
        return;
      }
      setPendingDiscard({
        scope: "single",
        entry: {
          key: `-:${entry.path}`,
          path: entry.path,
          mode: "-",
          indexStatus: " ",
          worktreeStatus: entry.statusCode,
          statusLabel: entry.statusLabel,
          statusCode: entry.statusCode,
          originalPath: entry.originalPath,
          untracked: entry.untracked,
        },
      });
    },
    [dirtyPaths, repo, summary.busyAction, t],
  );

  const generateCommitMessage = useCallback(async () => {
    if (!isAiRuntimeAvailable()) return;
    const hasStaged = stagedEntries.length > 0;
    const targetEntries = hasStaged ? stagedEntries : fileEntries;
    if (!repo || targetEntries.length === 0) return;
    if (aiBusy) {
      setActionError(t("feedback.waitAiAction"));
      return;
    }
    if (aiUnavailableReason) {
      setActionError(aiUnavailableReason);
      return;
    }
    setLocalActionBusy("generate-message");
    setActionMessage(null);
    setActionError(null);
    try {
      const [{ buildConfiguredLanguageModel }, { generateText }, diff] =
        await Promise.all([
          import("@/modules/ai/lib/agent"),
          import("ai"),
          native.gitDiff(repo.repoRoot, null, hasStaged),
        ]);
      const { text: diffText, truncated } = truncateDiff(diff.diffText);
      const chatState = useChatStore.getState();
      const prefs = usePreferencesStore.getState();
      const targetLanguageName = prefs.gitCommitMessageUseEditorLanguage
        ? COMMIT_MESSAGE_LANGUAGE_NAMES[prefs.language] || prefs.language
        : undefined;

      const model = await buildConfiguredLanguageModel(
        selectedModelId,
        chatState.apiKeys,
        {
          lmstudioBaseURL: prefs.lmstudioBaseURL,
          lmstudioModelId,
          mlxBaseURL: prefs.mlxBaseURL,
          mlxModelId,
          ollamaBaseURL: prefs.ollamaBaseURL,
          ollamaModelId,
          openaiCompatibleBaseURL,
          openaiCompatibleModelId,
          openrouterModelId,
        },
      );
      const result = await generateText({
        model,
        system: getCommitMessageSystemPrompt(targetLanguageName),
        prompt: buildCommitMessagePrompt(
          targetEntries,
          diffText,
          truncated,
          targetLanguageName,
        ),
        maxOutputTokens: COMMIT_MESSAGE_MAX_OUTPUT_TOKENS,
        ...(selectedModelSupportsTemperature ? { temperature: 0.2 } : {}),
      });
      let message = cleanCommitMessage(result.text);
      if (!isValidCommitMessage(message)) {
        const repair = await generateText({
          model,
          system: getCommitMessageSystemPrompt(targetLanguageName),
          prompt: buildRepairCommitMessagePrompt(message, targetEntries),
          maxOutputTokens: COMMIT_MESSAGE_MAX_OUTPUT_TOKENS,
          ...(selectedModelSupportsTemperature ? { temperature: 0 } : {}),
        });
        message = cleanCommitMessage(repair.text);
      }
      if (!isValidCommitMessage(message)) {
        throw new Error(t("feedback.invalidCommitMessage"));
      }
      setCommitMessage(message);
      setActionMessage(null);
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [
    aiBusy,
    aiUnavailableReason,
    fileEntries,
    lmstudioModelId,
    mlxModelId,
    ollamaModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
    openrouterModelId,
    repo,
    selectedModelId,
    selectedModelSupportsTemperature,
    stagedEntries,
    t,
  ]);

  const generateSemanticGroups = useCallback(async () => {
    if (!isAiRuntimeAvailable()) return;
    if (!repo || fileEntries.length === 0) return;
    if (aiBusy) {
      setActionError(t("feedback.waitAiAction"));
      return;
    }
    if (!hasApiKeyForSelected) {
      setActionError(t("feedback.connectAiForSemanticStaging"));
      return;
    }
    setLocalActionBusy("semantic-staging");
    setActionMessage(null);
    setActionError(null);
    try {
      const chatState = useChatStore.getState();
      const prefs = usePreferencesStore.getState();
      const groups = await generateSemanticStagingGroups({
        repoRoot: repo.repoRoot,
        files: fileEntries,
        selectedModelId,
        apiKeys: chatState.apiKeys,
        preferences: {
          lmstudioBaseURL: prefs.lmstudioBaseURL,
          lmstudioModelId,
          mlxBaseURL: prefs.mlxBaseURL,
          mlxModelId,
          ollamaBaseURL: prefs.ollamaBaseURL,
          ollamaModelId,
          openaiCompatibleBaseURL,
          openaiCompatibleModelId,
          openrouterModelId,
        },
      });
      setSemanticGroups(groups);
      setSemanticStagingOpen(groups.length > 0);
      if (groups.length === 0) {
        setActionMessage(t("feedback.noCommitGroups"));
      }
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [
    aiBusy,
    fileEntries,
    hasApiKeyForSelected,
    lmstudioModelId,
    mlxModelId,
    ollamaModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
    openrouterModelId,
    repo,
    selectedModelId,
  ]);

  const applySemanticGroup = useCallback(
    async (group: SemanticCommitGroup) => {
      if (!repo) return;
      const pathsToStage = new Set(group.files);
      await runMutation(
        `semantic-stage:${group.id}`,
        (s) => optimisticStage(s, pathsToStage),
        async () => {
          if (stagedEntries.length > 0) {
            const allStaged = stagedEntries.map((e) => e.path);
            await native.gitUnstage(repo.repoRoot, allStaged);
          }
          await native.gitStage(repo.repoRoot, group.files);
        },
        [...pathsToStage],
      );
      setCommitMessage(group.message);
      setActionMessage(
        t("feedback.stagedFiles", {
          count: group.files.length,
          message: group.message,
        }),
      );
    },
    [repo, runMutation, stagedEntries],
  );

  const commit = useCallback(async () => {
    if (!repo || summary.busyAction) return;
    setLocalActionBusy("commit");
    setActionMessage(null);
    setActionError(null);
    let committed = false;
    try {
      const result = await native.gitCommit(repo.repoRoot, commitMessage);
      committed = true;
      playVokttySound("success", { retrigger: "restart" });
      setCommitMessage("");
      setActionMessage(
        t("feedback.committed", {
          sha: result.commitSha.slice(0, 7),
          summary: result.summary,
        }),
      );
      invalidateRepoDiffs(repo.repoRoot);
      await summary.refresh({ remote: "never" });
    } catch (error) {
      setActionError(normalizeError(error));
      if (!committed) playVokttySound("error", { retrigger: "restart" });
    } finally {
      setLocalActionBusy(null);
    }
  }, [commitMessage, repo, summary]);

  const push = useCallback(async () => {
    if (!repo) return;
    setActionMessage(null);
    setActionError(null);
    const result = await summary.runRemoteAction("push");
    if (result.ok) {
      setActionMessage(
        status?.upstream
          ? t("feedback.pushed", { upstream: status.upstream })
          : t("feedback.pushCompleted"),
      );
      return;
    }
    if (result.error) {
      setActionError(result.error);
    }
  }, [repo, status?.upstream, summary]);

  const pendingDiscardView = useMemo<PendingDiscard | null>(() => {
    if (!pendingDiscard) return null;
    if (pendingDiscard.scope === "single") {
      return {
        scope: "single",
        count: 1,
        label: pendingDiscard.entry.path,
      };
    }
    return {
      scope: "all",
      count: pendingDiscard.entries.length,
      label: t("git.unstagedFiles", { count: pendingDiscard.entries.length }),
    };
  }, [pendingDiscard, t]);

  return {
    panelState,
    repo,
    status,
    selected,
    commitMessage,
    actionBusy: localActionBusy ?? summary.busyAction,
    statusError: summary.localError,
    dubiousOwnershipPath: summary.dubiousOwnershipPath,
    actionError,
    remoteError: summary.lastRemoteError,
    actionMessage,
    stagedEntries,
    unstagedEntries,
    fileEntries,
    headerCheckState,
    allClean,
    canPush,
    pushHint,
    canGenerateCommitMessage,
    generateCommitMessageHint,
    selectionTransition,
    stagedEmptyText,
    unstagedEmptyText,
    pendingDiscard: pendingDiscardView,
    semanticGroups,
    semanticStagingOpen,
    setSemanticStagingOpen,
    generateSemanticGroups,
    applySemanticGroup,
    setCommitMessage,
    refresh,
    trustRepository: summary.trustRepository,
    initRepository: summary.initRepository,
    selectEntry,
    selectFile,
    stageEntry,
    unstageEntry,
    toggleStageFile,
    toggleAll,
    requestDiscardEntry,
    requestDiscardFile,
    requestDiscardAll,
    confirmPendingDiscard,
    cancelPendingDiscard,
    stageAllEntries,
    unstageAllEntries,
    generateCommitMessage,
    commit,
    push,
  };
}
