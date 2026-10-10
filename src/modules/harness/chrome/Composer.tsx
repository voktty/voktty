import {
  ArrowUp,
  Check,
  CornerDownRight,
  ListEnd,
  Pause,
  Pencil,
  Play,
  Plus,
  Square,
  StickyNote,
  Trash2,
  X,
} from "./icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "@/modules/i18n";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
  mergeAttachments,
  pickAttachments,
  revokeAttachment,
} from "../lib/attachments";
import { messageFilesFromClipboard } from "../lib/clipboard";
import { resizeComposer } from "../lib/composerResize";
import {
  EXPLORER_FILE_POINTER_DRAG_EVENT,
  type ExplorerFilePointerDragDetail,
} from "../lib/drag";
import { dragPointToClient } from "../lib/dragPoint";
import type { ContextUsage } from "../lib/contextUsage";
import {
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../lib/fileIndex";
import {
  buildMentionIndex,
  fileMentionParts,
  mentionLabel,
  mentionTokenAt,
  rankMentionFiles,
  replaceMentionToken,
  type MentionIndex,
  type MentionToken,
} from "../lib/fileMentions";
import type { ProjectFile } from "../lib/fs";
import {
  composeInboxMessage,
  type InboxComposerCard,
} from "../lib/githubTasks";
import type { HandoffComposerCard } from "../lib/handoff";
import { looksLikeProject, type RecentProject } from "../lib/recents";
import type {
  Attachment,
  HarnessId,
  MessageQueueStatus,
  NetworkSandboxConfig,
  QueuedMessage,
  RuntimeMode,
} from "../lib/session";
import { harnessSupportsAttachments } from "../lib/session";
import {
  createBlankSkill,
  rankSkills,
  replaceSlashToken,
  skillTextParts,
  slashTokenAt,
  type Skill,
  type SlashToken,
} from "../lib/skills";
import { isImeComposition } from "../lib/keyboard";
import { AccessPicker } from "./AccessPicker";
import { NetworkSandboxPicker } from "./NetworkSandboxPicker";
import { ComposerRunner } from "./ComposerRunner";
import { ContextMeter } from "./ContextMeter";
import { AttachmentChip } from "./AttachmentChip";
import { BranchPicker } from "./BranchPicker";
import { CwdPicker } from "./CwdPicker";
import { FileMentionPicker } from "./FileMentionPicker";
import { FileTypeIcon } from "./FileTypeIcon";
import { InboxMiniCard } from "./InboxMiniCard";
import { NoteMiniCard } from "./NoteMiniCard";
import { HandoffMiniCard } from "./HandoffMiniCard";
import { ModelPicker } from "./ModelPicker";
import { QuestionForm } from "./QuestionForm";
import { SkillPicker } from "./SkillPicker";
import type { UserQuestionPrompt, UserQuestionReply } from "../lib/userQuestion";
import { projectKey } from "../lib/paths";
import { consumeQuoteRequest, type QuoteRequest } from "../lib/quoteDraft";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import {
  COMPOSER_RUNNER_CHANGE_EVENT,
  loadComposerRunner,
  loadNotesEnabled,
  subscribeNotesEnabled,
} from "../lib/settings";
import {
  isNoteMentionPath,
  loadNotes,
  peekNotes,
  rankNoteFiles,
  notesAsProjectFiles,
  type Note,
  type NoteComposerCard,
} from "../lib/notes";
import { resolveTabGroupLogo } from "../lib/tabGroups";
import { useComposerSkills } from "./useComposerSkills";
import {
  LiveComponentBadge,
  useLiveComponentStore,
  formatComponentPromptDirective,
} from "@/modules/preview";
import { COMPACT_COMMAND, isCompactCommand } from "../lib/compact";
import { PLAN_COMMAND, consumePlanCommand } from "../lib/plan";
import {
  ORCHESTRATOR_COMMAND,
  consumeOrchestratorCommand,
} from "../lib/orchestratorCommand";
import { DRAFT_COMMAND, consumeDraftCommand } from "../lib/draftCommand";
import {
  leadingModeCommand,
  MODE_COMMAND_INDENT,
  ModeCommandPill,
  ModeCommandText,
  type ModeCommandToken,
} from "./modeCommands";
import { McpServerPicker } from "./McpServerPicker";
import {
  MCP_COMMAND,
  isMcpCommand,
  getCachedMcpSettings,
  loadMcpSettings,
  mcpContextText,
  mcpTagParts,
  newMcpTag,
  subscribeMcpSettings,
  taggedMcpServers,
  type McpConnection,
  type McpSettingsSnapshot,
  type McpTag,
} from "../mcp";
import type { LastTurnRecall } from "../lib/editLastTurn";
import type { ComposerTurnOptions } from "../lib/session";

type Props = {
  enabled?: boolean;
  focused: boolean;
  /** Bump to force a refocus even when `focused` was already true (e.g. window regains OS focus). */
  focusToken?: number;
  shell?: boolean;
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode: RuntimeMode;
  networkSandbox?: NetworkSandboxConfig;
  cwd?: string;
  executionCwd: string;
  branch?: string;
  recents?: RecentProject[];
  hideProjectPicker?: boolean;
  hideBranchPicker?: boolean;
  hideTopBar?: boolean;
  context?: ContextUsage;
  compactSupported?: boolean;
  editLastTurnSupported?: boolean;
  lastTurnRecall?: LastTurnRecall | null;
  quoteRequest?: QuoteRequest;
  initialDraft?: string;
  inboxCard?: InboxComposerCard;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  question?: UserQuestionPrompt;
  queuedMessages?: QueuedMessage[];
  queueStatus?: MessageQueueStatus;
  busy?: boolean;
  hotkeys?: boolean;
  onFocus: () => void;
  onCwdChange: (cwd: string) => void;
  onBranchChange?: () => void;
  onNewTerminal?: () => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange?: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onNetworkSandboxChange?: (config: NetworkSandboxConfig) => void;
  onQuoteRequestConsumed?: (id: number) => void;
  onInboxCardDismiss?: () => void;
  onNoteCardDismiss?: () => void;
  onHandoffCardDismiss?: () => void;
  onQuestionReply?: (requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (requestId: number) => void;
  canSaveDraft?: boolean;
  onSaveDraft?: (
    text: string,
    attachments: Attachment[],
  ) => void | boolean;
  onSubmit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => void | boolean;
  onStop?: () => void;
  onCompactContext?: () => boolean;
  onDeleteQueuedMessage?: (messageId: string) => void;
  onEditQueuedMessage?: (messageId: string, text: string) => void;
  onQueuedMessageEditingChange?: (messageId?: string) => void;
  onSteerQueuedMessage?: (messageId: string) => void;
  onResumeQueue?: () => void;
  onOpenFile?: (path: string) => void;
  onDraftChange?: (text: string) => void;
  onRecallLastTurnReady?: (recall: () => void) => void;
  onEditingLastTurnChange?: (editing: boolean) => void;
  children?: ReactNode;
};

function MessageQueue({
  messages,
  status,
  onDelete,
  onEdit,
  onEditingChange,
  onSteer,
  onResume,
}: {
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  onEditingChange?: (messageId?: string) => void;
  onSteer?: (messageId: string) => void;
  onResume?: () => void;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string>();
  const [editDraft, setEditDraft] = useState("");
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  useEffect(() => {
    return () => {
      if (editingIdRef.current) onEditingChangeRef.current?.();
    };
  }, []);
  if (messages.length === 0) return null;
  const paused = status === "paused";

  const startEdit = (message: QueuedMessage) => {
    setEditingId(message.id);
    setEditDraft(message.text);
    onEditingChange?.(message.id);
  };
  const cancelEdit = () => {
    setEditingId(undefined);
    setEditDraft("");
    onEditingChange?.();
  };
  const saveEdit = (message: QueuedMessage) => {
    if (!editDraft.trim() && message.attachments.length === 0) return;
    onEdit?.(message.id, editDraft);
    setEditingId(undefined);
    setEditDraft("");
  };

  return (
    <div className="px-2 text-content/55" data-message-queue>
      <div
        className="relative z-0 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2 py-1"
        data-message-queue-card
      >
        {paused ? (
          <div className="flex h-7 items-center gap-2 border-b border-content/10 text-[12px]">
            <Pause className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {t("harness.chrome.queuePaused")}
            </span>
            <button
              type="button"
              onClick={onResume}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
            >
              <Play className="size-3.5" />
              {t("harness.chrome.resume")}
            </button>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const editing = editingId === message.id;
          const label =
            message.text.trim() ||
            t("harness.chrome.attachmentCount", { count: message.attachments.length });
          return (
            <div
              key={message.id}
              className={`flex min-h-7 items-center gap-2 text-[12px] ${
                index > 0 ? "border-t border-content/10" : ""
              }`}
            >
              <ListEnd className="size-3.5 shrink-0" />
              {editing ? (
                <>
                  <textarea
                    autoFocus
                    aria-label={t("harness.chrome.editQueued")}
                    value={editDraft}
                    rows={1}
                    onChange={(event) => setEditDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        saveEdit(message);
                      }
                    }}
                    className="min-h-6 min-w-0 flex-1 resize-none rounded-md border border-content/15 bg-content/5 px-1.5 py-0.5 text-[12px] text-content outline-none focus:border-content/30"
                  />
                  <button
                    type="button"
                    title={t("harness.chrome.saveQueued")}
                    aria-label={t("harness.chrome.saveQueued")}
                    disabled={
                      !editDraft.trim() && message.attachments.length === 0
                    }
                    onClick={() => saveEdit(message)}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content disabled:opacity-30"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t("harness.chrome.cancelQueuedEdit")}
                    aria-label={t("harness.chrome.cancelQueuedEdit")}
                    onClick={cancelEdit}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-content/80">
                    {label}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSteer?.(message.id)}
                    className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
                  >
                    <CornerDownRight className="size-3.5" />
                    {t("harness.chrome.steer")}
                  </button>
                  <button
                    type="button"
                    title={t("harness.chrome.editQueued")}
                    aria-label={t("harness.chrome.editQueued")}
                    onClick={() => startEdit(message)}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t("harness.chrome.removeQueued")}
                    aria-label={t("harness.chrome.removeQueued")}
                    onClick={() => onDelete?.(message.id)}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-6.5 shrink-0 place-items-center rounded-md ${
        active
          ? "bg-content/20 text-content"
          : "bg-content/10 text-content/50 hover:bg-content/15 hover:text-content"
      } disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content/50`}
    >
      {children}
    </button>
  );
}

export function Composer({
  enabled = true,
  focused,
  focusToken,
  hotkeys = false,
  shell = false,
  harness,
  model,
  modelSettings = {},
  runtimeMode,
  networkSandbox,
  cwd = "~",
  executionCwd,
  branch,
  recents = [],
  hideProjectPicker = false,
  hideBranchPicker = false,
  hideTopBar = false,
  context,
  compactSupported = false,
  editLastTurnSupported = false,
  lastTurnRecall = null,
  quoteRequest,
  initialDraft,
  inboxCard,
  noteCard,
  handoffCard,
  question,
  queuedMessages = [],
  queueStatus,
  busy = false,
  onFocus,
  onCwdChange,
  onBranchChange,
  onNewTerminal,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onNetworkSandboxChange,
  onQuoteRequestConsumed,
  onInboxCardDismiss,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  onQuestionReply,
  onQuestionInteraction,
  canSaveDraft,
  onSaveDraft,
  onSubmit,
  onStop,
  onCompactContext,
  onDeleteQueuedMessage,
  onEditQueuedMessage,
  onQueuedMessageEditingChange,
  onSteerQueuedMessage,
  onResumeQueue,
  onOpenFile,
  onDraftChange,
  onRecallLastTurnReady,
  onEditingLastTurnChange,
  children,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const borrowedAttachmentIdsRef = useRef(new Set<string>());
  const draftRevisionRef = useRef(0);
  const dropReadGenerationRef = useRef(0);
  const dropReadFlightsRef = useRef(new Set<Promise<void>>());
  const dropReadWaitersRef = useRef(new Set<() => void>());
  const submitWaitingForDropsRef = useRef(false);
  const submitRef = useRef<((value: string) => void) | undefined>(undefined);
  const invalidateDropReads = useCallback(() => {
    dropReadGenerationRef.current += 1;
    for (const wake of dropReadWaitersRef.current) wake();
    dropReadWaitersRef.current.clear();
  }, []);
  const consumedQuoteId = useRef<number | null>(null);
  const positionedInitialDraft = useRef(false);
  const slashRef = useRef<SlashToken | null>(null);
  const mentionRef = useRef<MentionToken | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  // Changing defaultValue rewrites the text node and commits WebKit IME.
  // Later drafts are applied by the existing effect without changing it.
  const [mountDraft] = useState(initialDraft);
  const [resendEdited, setResendEdited] = useState(false);
  const [planSelected, setPlanSelected] = useState(false);
  const [orchestrationSelected, setOrchestrationSelected] = useState(false);
  const [draftSelected, setDraftSelected] = useState(false);
  const [hasValue, setHasValue] = useState(
    () =>
      (initialDraft ?? "").trim().length > 0 ||
      !!inboxCard ||
      !!noteCard ||
      !!handoffCard,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileDrag, setFileDrag] = useState(false);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [skillActive, setSkillActive] = useState(0);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>(
    () => peekProjectFiles(cwd) ?? [],
  );
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const [notes, setNotes] = useState<Note[]>(() => peekNotes() ?? []);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [runnerEnabled, setRunnerEnabled] = useState(loadComposerRunner);
  const [runnerLive, setRunnerLive] = useState(
    () => busy && loadComposerRunner(),
  );
  const { t } = useTranslation();
  const selectedComponent = useLiveComponentStore((s) => s.selectedComponent);
  const groupLogos = useTabGroupLogos();
  const projectLogoPath = resolveTabGroupLogo(projectKey(cwd), groupLogos);

  slashRef.current = slash;
  mentionRef.current = mention;

  attachmentsRef.current = attachments;

  const mentionOpen =
    mention !== null && (looksLikeProject(cwd) || notesEnabled);
  const navigationEmpty =
    draft.length === 0 &&
    attachments.length === 0 &&
    !inboxCard &&
    !noteCard &&
    !handoffCard;
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [mcpStatus, setMcpStatus] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const [selectedMcp, setSelectedMcp] = useState<McpTag[]>([]);
  const mcpInsertAt = useRef<number | null>(null);

  const pickerOpen = creatingSkill || slash !== null || mcpPickerOpen;
  const skillCatalog = useComposerSkills({
    harness,
    executionCwd,
    pickerOpen,
  });
  const skills = skillCatalog.skills;
  const slashItems = useMemo(
    () => [
      PLAN_COMMAND,
      ORCHESTRATOR_COMMAND,
      ...(canSaveDraft && onSaveDraft ? [DRAFT_COMMAND] : []),
      COMPACT_COMMAND,
      MCP_COMMAND,
      ...skills.filter(
        (skill) =>
          skill.name !== COMPACT_COMMAND.name &&
          skill.name !== PLAN_COMMAND.name &&
          skill.name !== ORCHESTRATOR_COMMAND.name &&
          skill.name !== DRAFT_COMMAND.name &&
          skill.name !== MCP_COMMAND.name,
      ),
    ],
    [skills, canSaveDraft, onSaveDraft],
  );
  const skillLimit =
    harness === "pi" ? Number.POSITIVE_INFINITY : undefined;
  const rankedSkills = rankSkills(
    slashItems,
    slash?.query ?? "",
    skillLimit,
  );
  const attachmentsSupported = harnessSupportsAttachments(harness);
  const skillNames = useMemo(
    () => new Set(slashItems.map((skill) => skill.invocation)),
    [slashItems],
  );
  const leadingMode = leadingModeCommand(draft, skillNames);
  const modeIndent = leadingMode ? MODE_COMMAND_INDENT : undefined;
  useLayoutEffect(() => {
    // The indent can rewrap the first line after the input already resized.
    if (ref.current) resizeComposer(ref.current);
  }, [modeIndent]);

  // A leading mode command in the text shows the same pill as picking the mode.
  const orchestrationActive =
    orchestrationSelected || leadingMode?.name === ORCHESTRATOR_COMMAND.name;
  const draftActive = draftSelected || leadingMode?.name === DRAFT_COMMAND.name;
  const planActive = planSelected || leadingMode?.name === PLAN_COMMAND.name;

  /** Turning a mode off also drops its leading command from the text. */
  const clearLeadingMode = (name: string) => {
    const el = ref.current;
    if (!el || leadingModeCommand(el.value, skillNames)?.name !== name) return;
    const next = el.value.replace(/^\/[a-z]+\s?/, "");
    el.value = next;
    resizeComposer(el);
    el.setSelectionRange(0, 0);
    setDraft(next);
    onDraftChange?.(next);
    syncHasValue(next, attachmentsRef.current);
  };

  const openMcpPicker = useCallback(() => {
    setMcpConnections([]);
    setMcpStatus(new Map());
    setMcpError("");
    setMcpLoading(true);
    setMcpPickerOpen(true);
  }, []);

  useEffect(() => {
    if (!mcpPickerOpen) return;
    const apply = (snapshot: McpSettingsSnapshot) => {
      setMcpConnections(snapshot.servers);
      setMcpStatus(
        new Map(
          snapshot.servers
            .filter((server) => server.provider === "claude")
            .map((server) => [server.name, server.status]),
        ),
      );
      setMcpError(snapshot.error);
      setMcpLoading(false);
    };
    const stop = subscribeMcpSettings(executionCwd, apply);
    const cached = getCachedMcpSettings(executionCwd);
    if (cached) apply(cached);
    void loadMcpSettings(executionCwd, false, {
      claudeHealth: harness === "claude",
    });
    return stop;
  }, [executionCwd, harness, mcpPickerOpen]);

  useEffect(() => {
    setMcpPickerOpen(false);
  }, [executionCwd, harness]);
  const mentionFiles = useMemo(
    () =>
      notesEnabled ? [...files, ...notesAsProjectFiles(notes)] : files,
    [files, notes, notesEnabled],
  );
  const mentionIndex = useMemo(
    () => buildMentionIndex(mentionFiles),
    [mentionFiles],
  );
  const mentionIndexRef = useRef<MentionIndex>(mentionIndex);
  mentionIndexRef.current = mentionIndex;
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const fileHits = looksLikeProject(cwd)
      ? rankMentionFiles(files, mention?.query ?? "", recentOpenedFiles(cwd))
      : [];
    const noteHits = notesEnabled
      ? rankNoteFiles(notes, mention?.query ?? "")
      : [];
    const seen = new Set(noteHits.map((file) => file.path));
    return [...noteHits, ...fileHits.filter((file) => !seen.has(file.path))];
  }, [cwd, files, mention?.query, mentionOpen, notes, notesEnabled]);

  const syncHasValue = useCallback(
    (text: string, files: Attachment[]) => {
      setHasValue(
        text.trim().length > 0 ||
          files.length > 0 ||
          !!inboxCard ||
          !!noteCard ||
          !!handoffCard,
      );
    },
    [inboxCard, noteCard, handoffCard],
  );

  useEffect(() => {
    syncHasValue(ref.current?.value ?? "", attachmentsRef.current);
  }, [inboxCard, noteCard, handoffCard, syncHasValue]);

  const addAttachments = useCallback(
    (incoming: Attachment[]) => {
      if (!harnessSupportsAttachments(harness) || incoming.length === 0) return;
      const next = mergeAttachments(attachmentsRef.current, incoming);
      attachmentsRef.current = next;
      setAttachments(next);
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [harness, syncHasValue],
  );

  const fileDropStateRef = useRef({ attachmentsSupported, addAttachments });
  fileDropStateRef.current = { attachmentsSupported, addAttachments };

  const readDroppedAttachments = useCallback(
    (read: () => Promise<Attachment[]>) => {
      const generation = dropReadGenerationRef.current;
      const flight = read()
        .then((incoming) => {
          if (
            generation !== dropReadGenerationRef.current ||
            !fileDropStateRef.current.attachmentsSupported
          ) {
            incoming.forEach(revokeAttachment);
            return;
          }
          fileDropStateRef.current.addAttachments(incoming);
        })
        .catch(() => undefined);
      dropReadFlightsRef.current.add(flight);
      void flight.finally(() => dropReadFlightsRef.current.delete(flight));
    },
    [],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const previous = attachmentsRef.current;
      const removed = previous.find((file) => file.id === id);
      if (removed) revokeAttachment(removed);
      const next = previous.filter((file) => file.id !== id);
      attachmentsRef.current = next;
      setAttachments(next);
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [syncHasValue],
  );

  const restoreDraft = useCallback(
    (
      text: string,
      nextAttachments: Attachment[],
      borrowedIds: ReadonlySet<string> = borrowedAttachmentIdsRef.current,
    ) => {
      setDraft(text);
      onDraftChange?.(text);
      if (ref.current) {
        ref.current.value = text;
        resizeComposer(ref.current);
      }

      const nextIds = new Set(nextAttachments.map((file) => file.id));
      for (const file of attachmentsRef.current) {
        if (
          nextIds.has(file.id) ||
          borrowedAttachmentIdsRef.current.delete(file.id)
        ) {
          continue;
        }
        revokeAttachment(file);
      }
      borrowedAttachmentIdsRef.current = new Set(
        nextAttachments
          .filter((file) => borrowedIds.has(file.id))
          .map((file) => file.id),
      );
      attachmentsRef.current = nextAttachments;
      setAttachments(nextAttachments);
      syncHasValue(text, nextAttachments);
      ref.current?.focus();
    },
    [onDraftChange, syncHasValue],
  );

  const exitEditMode = useCallback(() => {
    draftRevisionRef.current += 1;
    invalidateDropReads();
    if (ref.current) {
      ref.current.value = "";
      ref.current.style.height = "auto";
    }
    setDraft("");
    onDraftChange?.("");
    const previous = attachmentsRef.current;
    for (const file of previous) {
      if (!borrowedAttachmentIdsRef.current.delete(file.id)) {
        revokeAttachment(file);
      }
    }
    attachmentsRef.current = [];
    setAttachments([]);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    syncHasValue("", []);
    ref.current?.focus();
  }, [
    invalidateDropReads,
    onDraftChange,
    onEditingLastTurnChange,
    syncHasValue,
  ]);

  const recallLastTurn = useCallback(() => {
    if (!editLastTurnSupported || !lastTurnRecall) return;
    if (resendEdited) {
      exitEditMode();
      return;
    }
    restoreDraft(
      lastTurnRecall.text,
      lastTurnRecall.attachments,
      new Set(lastTurnRecall.attachments.map((file) => file.id)),
    );
    setResendEdited(true);
    onEditingLastTurnChange?.(true);
  }, [
    editLastTurnSupported,
    exitEditMode,
    lastTurnRecall,
    onEditingLastTurnChange,
    resendEdited,
    restoreDraft,
  ]);

  useEffect(() => {
    if (editLastTurnSupported) return;
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
  }, [editLastTurnSupported, onEditingLastTurnChange]);

  useEffect(() => {
    if (!editLastTurnSupported || !onRecallLastTurnReady) return;
    onRecallLastTurnReady(recallLastTurn);
  }, [editLastTurnSupported, onRecallLastTurnReady, recallLastTurn]);

  useEffect(() => {
    return () => {
      invalidateDropReads();
      for (const file of attachmentsRef.current) revokeAttachment(file);
    };
  }, [invalidateDropReads]);

  useEffect(() => {
    if (harnessSupportsAttachments(harness)) return;
    invalidateDropReads();
    setAttachments((prev) => {
      if (prev.length === 0) return prev;
      for (const file of prev) revokeAttachment(file);
      syncHasValue(ref.current?.value ?? "", []);
      return [];
    });
  }, [harness, invalidateDropReads, syncHasValue]);

  useEffect(() => {
    const refresh = () => setRunnerEnabled(loadComposerRunner());
    window.addEventListener(COMPOSER_RUNNER_CHANGE_EVENT, refresh);
    return () =>
      window.removeEventListener(COMPOSER_RUNNER_CHANGE_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!runnerEnabled) {
      setRunnerLive(false);
      return;
    }
    if (busy) setRunnerLive(true);
  }, [busy, runnerEnabled]);

  useEffect(() => {
    setSkillActive(0);
  }, [slash?.query, cwd]);

  useEffect(() => {
    setSkillActive((index) =>
      rankedSkills.length === 0 ? 0 : Math.min(index, rankedSkills.length - 1),
    );
  }, [rankedSkills.length]);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: ProjectFile[]) => {
      if (!cancelled) setFiles(next);
    };
    const cached = peekProjectFiles(cwd);
    if (cached) apply(cached);
    void loadProjectFiles(cwd, mentionOpen)
      .then(apply)
      .catch(() => undefined);
    const unsub = subscribeProjectFiles(() => {
      const next = peekProjectFiles(cwd);
      if (next) apply(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [cwd, mentionOpen]);

  useEffect(() => {
    if (!mentionOpen || !notesEnabled) return;
    let cancelled = false;
    void loadNotes().then((next) => {
      if (!cancelled) setNotes(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, notesEnabled]);

  useEffect(() => {
    setMentionActive(0);
  }, [mention?.query, cwd]);

  useEffect(() => {
    setMentionActive((index) =>
      rankedFiles.length === 0 ? 0 : Math.min(index, rankedFiles.length - 1),
    );
  }, [rankedFiles.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !initialDraft) return;
    if (el.value !== initialDraft) el.value = initialDraft;
    if (!positionedInitialDraft.current) {
      positionedInitialDraft.current = true;
      el.selectionStart = el.value.length;
      el.selectionEnd = el.value.length;
    }
    resizeComposer(el);
  }, [initialDraft]);

  // Drafts changed while hidden could not be measured. Inbox panes are portaled
  // into place by a parent effect that runs after this one, so the first pass
  // can still find no layout box; retry once the move has landed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    resizeComposer(el);
    if (el.scrollHeight !== 0) return;
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) resizeComposer(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const syncHighlightScroll = useCallback((el: HTMLTextAreaElement) => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    highlight.scrollTop = el.scrollTop;
    highlight.scrollLeft = el.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    syncHighlightScroll(el);
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) syncHighlightScroll(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft, syncHighlightScroll]);

  const syncTokensFromTextarea = (el: HTMLTextAreaElement) => {
    if (creatingSkill) return;
    const cursor = el.selectionStart ?? 0;
    const token = slashTokenAt(el.value, cursor);
    setSlash(token);
    setMention(token ? null : mentionTokenAt(el.value, cursor));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !quoteRequest) return;

    const result = consumeQuoteRequest(
      el.value,
      consumedQuoteId.current,
      quoteRequest,
    );
    consumedQuoteId.current = result.consumedId;
    if (result.changed) {
      el.value = result.draft;
      resizeComposer(el);
      setDraft(result.draft);
      syncHasValue(result.draft, attachmentsRef.current);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      el.setSelectionRange(result.draft.length, result.draft.length);
      el.focus();
    }
    onQuoteRequestConsumed?.(quoteRequest.id);
  }, [onQuoteRequestConsumed, quoteRequest, syncHasValue]);

  const pickSkill = useCallback(
    (skill: Skill) => {
      const el = ref.current;
      const token = slashRef.current;
      if (!el || !token) {
        setSlash(null);
        setCreatingSkill(false);
        return;
      }
      if (skill.kind === "builtin" && skill.name === MCP_COMMAND.name) {
        const next = `${el.value.slice(0, token.start)}${el.value.slice(token.end).replace(/^\s/, "")}`;
        el.value = next;
        resizeComposer(el);
        mcpInsertAt.current = token.start;
        el.setSelectionRange(token.start, token.start);
        setDraft(next);
        onDraftChange?.(next);
        syncHasValue(next, attachmentsRef.current);
        setSlash(null);
        openMcpPicker();
        return;
      }
      const next = replaceSlashToken(el.value, token, skill.invocation);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + skill.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setSlash(null);
      setCreatingSkill(false);
      el.focus();
    },
    [onDraftChange, openMcpPicker, syncHasValue],
  );

  const pickMention = useCallback(
    (file: ProjectFile) => {
      const el = ref.current;
      const token = mentionRef.current;
      if (!el || !token) {
        setMention(null);
        return;
      }
      const label = isNoteMentionPath(file.path)
        ? file.relative
        : mentionLabel(file, mentionIndexRef.current);
      const next = replaceMentionToken(el.value, token, label);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + label.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setMention(null);
      el.focus();
    },
    [syncHasValue],
  );

  useEffect(() => {
    if (!focused) return;
    if (
      document.querySelector(
        "[data-model-picker], [data-access-picker], [data-model-settings], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker]",
      )
    )
      return;
    ref.current?.focus();
  }, [focused]);

  useEffect(() => {
    if (!enabled) {
      setFileDrag(false);
      return;
    }
    const dropRoot = () =>
      boxRef.current?.closest("[data-session-drop]") as HTMLElement | null;
    let nativeDropAt = 0;
    let cancelled = false;

    const overTarget = (x: number, y: number) => {
      const root = dropRoot();
      if (!root) return false;
      const rect = root.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const onDragOver = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      const supported = fileDropStateRef.current.attachmentsSupported;
      data.dropEffect = supported ? "copy" : "none";
      setFileDrag(supported);
    };
    const onDragLeave = (event: DragEvent) => {
      const root = dropRoot();
      if (!root) return;
      const next = event.relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      setFileDrag(false);
    };
    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      setFileDrag(false);
      if (!fileDropStateRef.current.attachmentsSupported) return;
      if (Date.now() - nativeDropAt < 250) return;
      const files = filesFromClipboard(data);
      if (files.length === 0) return;
      readDroppedAttachments(() => attachmentsFromFiles(files));
    };

    const onExplorerFilePointerDrag = (event: Event) => {
      const detail = (event as CustomEvent<ExplorerFilePointerDragDetail>)
        .detail;
      if (!detail || detail.type === "end") {
        setFileDrag(false);
        return;
      }
      const over = overTarget(detail.x, detail.y);
      const supported = fileDropStateRef.current.attachmentsSupported;
      if (detail.type === "move") {
        setFileDrag(over && supported);
        return;
      }
      setFileDrag(false);
      if (!over || !supported) return;
      readDroppedAttachments(() => attachmentsFromPaths([detail.path]));
    };

    const root = dropRoot();
    root?.addEventListener("dragover", onDragOver);
    root?.addEventListener("dragleave", onDragLeave);
    root?.addEventListener("drop", onDrop);
    window.addEventListener(
      EXPLORER_FILE_POINTER_DRAG_EVENT,
      onExplorerFilePointerDrag,
    );

    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type === "leave") {
          setFileDrag(false);
          return;
        }
        const { x, y } = event.payload.position;
        const point = dragPointToClient(x, y);
        const over = overTarget(point.x, point.y);
        const supported = fileDropStateRef.current.attachmentsSupported;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setFileDrag(over && supported);
          return;
        }
        if (event.payload.type !== "drop") return;
        setFileDrag(false);
        if (!over || !supported) return;
        nativeDropAt = Date.now();
        const paths = event.payload.paths;
        readDroppedAttachments(() => attachmentsFromPaths(paths));
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      invalidateDropReads();
      root?.removeEventListener("dragover", onDragOver);
      root?.removeEventListener("dragleave", onDragLeave);
      root?.removeEventListener("drop", onDrop);
      window.removeEventListener(
        EXPLORER_FILE_POINTER_DRAG_EVENT,
        onExplorerFilePointerDrag,
      );
      unlisten?.();
    };
  }, [enabled, invalidateDropReads, readDroppedAttachments]);

  useEffect(() => {
    if (!attachmentsSupported) setFileDrag(false);
  }, [attachmentsSupported]);

  useEffect(() => {
    if (!focused) return;

    const composer = ref.current?.closest("[data-composer]");
    const activeComposer = document.activeElement?.closest("[data-composer]");
    if (activeComposer && activeComposer !== composer) return;

    if (
      composer?.querySelector(
        "[data-skill-picker], [data-session-folder-picker], [data-mention-picker], [data-composer-plus], [data-question-form]",
      )
    )
      return;
    // Model/access/branch/settings/file pickers render through a portal into
    // document.body (see Popover.tsx), so they never appear under this
    // composer's own DOM subtree — check the whole document for those.
    if (
      document.querySelector(
        "[data-model-picker], [data-access-picker], [data-model-settings], [data-file-picker], [data-branch-picker]",
      )
    )
      return;
    ref.current?.focus();
  }, [focused, question, busy, focusToken]);

  const submit = (value: string) => {
    if (submitWaitingForDropsRef.current) return;
    const pendingDrops = [...dropReadFlightsRef.current];
    if (pendingDrops.length > 0) {
      const generation = dropReadGenerationRef.current;
      submitWaitingForDropsRef.current = true;
      void (async () => {
        while (
          generation === dropReadGenerationRef.current &&
          dropReadFlightsRef.current.size > 0
        ) {
          const pending = [...dropReadFlightsRef.current];
          await new Promise<void>((resolve) => {
            let settled = false;
            const wake = () => {
              if (settled) return;
              settled = true;
              dropReadWaitersRef.current.delete(wake);
              resolve();
            };
            dropReadWaitersRef.current.add(wake);
            void Promise.all(pending).then(wake);
          });
        }
      })().then(() => {
        submitWaitingForDropsRef.current = false;
        if (generation !== dropReadGenerationRef.current || !ref.current)
          return;
        submitRef.current?.(ref.current.value);
      });
      return;
    }

    if (isCompactCommand(value)) {
      if (!onCompactContext?.()) return;
      if (!ref.current) return;
      ref.current.value = "";
      ref.current.style.height = "auto";
      setDraft("");
      onDraftChange?.("");
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", attachments);
      return;
    }

    if (isMcpCommand(value)) {
      mcpInsertAt.current = 0;
      if (ref.current) {
        ref.current.value = "";
        ref.current.style.height = "auto";
      }
      setDraft("");
      onDraftChange?.("");
      setSlash(null);
      syncHasValue("", attachments);
      openMcpPicker();
      return;
    }

    const draftCommand = canSaveDraft
      ? consumeDraftCommand(value)
      : { text: value, matched: false };
    if ((draftSelected || draftCommand.matched) && onSaveDraft) {
      const files = attachmentsRef.current;
      const text = draftCommand.text;
      if (!text.trim() && files.length === 0) return;
      const accepted = onSaveDraft(
        mcpContextText(taggedMcpServers(text, selectedMcp), text),
        files,
      );
      if (accepted === false) return;
      if (!ref.current) return;
      ref.current.value = "";
      ref.current.style.height = "auto";
      setDraft("");
      onDraftChange?.("");
      invalidateDropReads();
      borrowedAttachmentIdsRef.current.clear();
      attachmentsRef.current = [];
      setAttachments([]);
      setSelectedMcp([]);
      setDraftSelected(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", attachmentsRef.current);
      return;
    }

    const command = consumePlanCommand(value);
    const orchestratorCommand = !command.planning
      ? consumeOrchestratorCommand(command.text)
      : { text: command.text, matched: false };

    let text = composeInboxMessage(inboxCard, orchestratorCommand.text);
    const files = attachmentsRef.current;
    const selectedComp = useLiveComponentStore.getState().selectedComponent;
    if (selectedComp) {
      const compDirective = formatComponentPromptDirective(selectedComp);
      text = text ? `${compDirective}\n\n${text}` : compDirective;
    }
    if (!text && files.length === 0 && !noteCard && !handoffCard) return;
    const resendDraftRevision = draftRevisionRef.current;
    const resendBorrowedAttachmentIds = new Set(borrowedAttachmentIdsRef.current);
    const resendSelectedMcp = selectedMcp;
    const submittedText = mcpContextText(
      taggedMcpServers(text, selectedMcp),
      text,
    );
    const accepted = onSubmit(
      submittedText,
      files,
      resendEdited
        ? {
            resendEdited: true,
            onResendRejected: ({ providerRewound }) => {
              if (draftRevisionRef.current !== resendDraftRevision) return;
              restoreDraft(text, files, resendBorrowedAttachmentIds);
              setSelectedMcp(resendSelectedMcp);
              setResendEdited(!providerRewound);
              onEditingLastTurnChange?.(!providerRewound);
            },
          }
        : undefined,
    );
    if (accepted === false) {
      restoreDraft(text, files);
      return;
    }
    if (!ref.current) return;
    ref.current.value = "";
    ref.current.style.height = "auto";
    setDraft("");
    onDraftChange?.("");
    invalidateDropReads();
    borrowedAttachmentIdsRef.current.clear();
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectedMcp([]);
    setResendEdited(false);
    setPlanSelected(false);
    setOrchestrationSelected(false);
    setDraftSelected(false);
    onEditingLastTurnChange?.(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    syncHasValue("", []);
  };
  submitRef.current = submit;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(e.nativeEvent)) return;
    if (creatingSkill) return;

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      (isCompactCommand(e.currentTarget.value) ||
        isMcpCommand(e.currentTarget.value))
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive((index) => (index + 1) % rankedFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive(
          (index) => (index - 1 + rankedFiles.length) % rankedFiles.length,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const file = rankedFiles[mentionActive];
        if (file) pickMention(file);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const file = rankedFiles[mentionActive];
        if (file) {
          e.preventDefault();
          pickMention(file);
          return;
        }
        setMention(null);
      }
    }

    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive((index) => (index + 1) % rankedSkills.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive(
          (index) => (index - 1 + rankedSkills.length) % rankedSkills.length,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const skill = rankedSkills[skillActive];
        if (skill) pickSkill(skill);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const skill = rankedSkills[skillActive];
        if (skill) {
          e.preventDefault();
          pickSkill(skill);
          return;
        }
        if (!slash.query) {
          e.preventDefault();
          return;
        }
        setSlash(null);
      }
    }

    if (
      e.key === "ArrowUp" &&
      editLastTurnSupported &&
      navigationEmpty &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      e.preventDefault();
      recallLastTurn();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e.currentTarget.value);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const messageFiles = messageFilesFromClipboard(e.clipboardData);
    if (messageFiles) {
      e.preventDefault();
      const el = e.currentTarget;
      el.setRangeText(
        e.clipboardData.getData("text/plain"),
        el.selectionStart,
        el.selectionEnd,
        "end",
      );
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (attachmentsSupported)
        void attachmentsFromFiles(messageFiles).then(addAttachments);
      return;
    }
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    if (!attachmentsSupported) return;
    void attachmentsFromFiles(files).then(addAttachments);
  };

  const attachFromPicker = () => {
    if (!attachmentsSupported) return;
    void pickAttachments().then((files) => {
      addAttachments(files);
      ref.current?.focus();
    });
  };

  return (
    <div
      data-composer
      className={`relative shrink-0 ${shell ? "" : "p-1.5 pt-0"}`}
      onMouseDown={onFocus}
    >
      {question && onQuestionReply ? (
        <QuestionForm
          prompt={question}
          onReply={onQuestionReply}
          onInteraction={onQuestionInteraction}
        />
      ) : null}
      {children}
      <MessageQueue
        messages={queuedMessages}
        status={queueStatus}
        onDelete={onDeleteQueuedMessage}
        onEdit={onEditQueuedMessage}
        onEditingChange={onQueuedMessageEditingChange}
        onSteer={onSteerQueuedMessage}
        onResume={onResumeQueue}
      />
      <div className="relative overflow-visible">
        {mcpPickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <McpServerPicker
              connections={mcpConnections}
              harness={harness}
              claudeStatus={mcpStatus}
              loading={mcpLoading}
              error={mcpError}
              onPick={(server) => {
                const el = ref.current;
                if (!el) return;
                const previous = selectedMcp.find(
                  (item) =>
                    item.server.provider === server.provider &&
                    item.server.name === server.name &&
                    item.server.scope === server.scope &&
                    item.server.configPath === server.configPath,
                );
                const tag = previous ?? newMcpTag(server, selectedMcp);
                if (!previous) setSelectedMcp((current) => [...current, tag]);
                if (!previous || !taggedMcpServers(el.value, [tag]).length) {
                  const at = Math.min(
                    mcpInsertAt.current ?? el.selectionStart,
                    el.value.length,
                  );
                  const before = el.value.slice(0, at);
                  const after = el.value.slice(at);
                  const leading = before && !/\s$/.test(before) ? " " : "";
                  const trailing = !after || /^\s/.test(after) ? " " : "";
                  const inserted = `${leading}${tag.token}${trailing}`;
                  const next = `${before}${inserted}${after}`;
                  el.value = next;
                  resizeComposer(el);
                  const cursor = at + inserted.length;
                  el.setSelectionRange(cursor, cursor);
                  draftRevisionRef.current += 1;
                  setDraft(next);
                  syncHasValue(next, attachmentsRef.current);
                  setMention(null);
                }
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                el.focus();
              }}
              onManage={() => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                window.dispatchEvent(new Event("voktty:open-mcp-settings"));
              }}
              onDismiss={(reason) => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                if (reason === "escape") ref.current?.focus();
              }}
            />
          </div>
        ) : pickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <SkillPicker
              skills={rankedSkills}
              query={slash?.query ?? ""}
              active={skillActive}
              creating={creatingSkill}
              cwd={cwd}
              error={createError}
              busy={createBusy}
              onActive={setSkillActive}
              onPick={pickSkill}
              onStartCreate={() => {
                setCreatingSkill(true);
                setCreateError(null);
              }}
              onCancelCreate={() => {
                setCreatingSkill(false);
                setCreateError(null);
                const el = ref.current;
                if (el) syncTokensFromTextarea(el);
                el?.focus();
              }}
              onCreate={(name, scope) => {
                setCreateBusy(true);
                setCreateError(null);
                void createBlankSkill({ cwd, name, scope })
                  .then((path) => {
                    const el = ref.current;
                    const token = slashRef.current;
                    if (el && token) {
                      const rest = el.value.slice(token.end).replace(/^\s/, "");
                      const next = `${el.value.slice(0, token.start)}${rest}`;
                      el.value = next;
                      resizeComposer(el);
                      el.setSelectionRange(token.start, token.start);
                      setDraft(next);
                      syncHasValue(next, attachments);
                    }
                    setCreatingSkill(false);
                    setSlash(null);
                    setCreateError(null);
                    void skillCatalog
                      .refresh({ refresh: true })
                      .catch(() => undefined);
                    onOpenFile?.(path);
                    el?.focus();
                  })
                  .catch((err: unknown) => {
                    setCreateError(
                      err instanceof Error ? err.message : String(err),
                    );
                  })
                  .finally(() => setCreateBusy(false));
              }}
            />
          </div>
        ) : null}
        {mentionOpen && !pickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <FileMentionPicker
              files={rankedFiles}
              query={mention?.query ?? ""}
              active={mentionActive}
              loading={
                looksLikeProject(cwd) && peekProjectFiles(cwd) == null
              }
              includeNotes={notesEnabled}
              onActive={setMentionActive}
              onPick={pickMention}
            />
          </div>
        ) : null}
        <div
          ref={boxRef}
          data-composer-box
          data-composer-editing={resendEdited ? "" : undefined}
          className={`relative z-10 border bg-content/3 backdrop-blur-sm ${
            resendEdited
              ? "edit-last-turn-composer rounded-lg"
              : "rounded-lg border-content/10 has-focus:border-content/20"
          } ${
            fileDrag
              ? "border-accent/60"
              : resendEdited
                ? ""
                : "border-content/10 has-focus:border-content/20"
          }`}
        >
          {fileDrag ? (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-accent/8 text-[12px] text-content/70">
              {t("harness.chrome.dropFilesToAttach")}
            </div>
          ) : null}
          {hideTopBar ? null : (
            <div className="flex min-w-0 items-center gap-2.5 px-3 pt-2.5">
              {hideProjectPicker ? null : (
                <CwdPicker
                  cwd={cwd}
                  recents={recents}
                  projectLogoPath={projectLogoPath}
                  enabled={enabled}
                  onCwdChange={onCwdChange}
                  onNewTerminal={onNewTerminal}
                  onClose={() => ref.current?.focus()}
                />
              )}
              {hideBranchPicker ? null : (
                <BranchPicker
                  cwd={cwd}
                  branch={branch}
                  enabled={enabled && !busy}
                  onChange={onBranchChange}
                  onClose={() => ref.current?.focus()}
                />
              )}
              <div className="ml-auto flex shrink-0 items-center">
                <ContextMeter
                  usage={context}
                  onCompact={compactSupported ? onCompactContext : undefined}
                  compactDisabled={busy}
                />
              </div>
            </div>
          )}

          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {attachments.map((file) => (
                <AttachmentChip
                  key={file.id}
                  attachment={file}
                  onRemove={() => removeAttachment(file.id)}
                />
              ))}
            </div>
          ) : null}

          {selectedComponent ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              <LiveComponentBadge compact />
            </div>
          ) : null}

          {inboxCard ? (
            <InboxMiniCard card={inboxCard} onDismiss={onInboxCardDismiss} />
          ) : null}

          {noteCard ? (
            <NoteMiniCard card={noteCard} onDismiss={onNoteCardDismiss} />
          ) : null}

          {handoffCard ? (
            <HandoffMiniCard
              card={handoffCard}
              onDismiss={onHandoffCardDismiss}
            />
          ) : null}

          <div className="relative">
            <div
              ref={highlightRef}
              aria-hidden
              className={`composer-highlight pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap break-words px-3 text-sm leading-5.5 text-content font-sans ${
                shell ? "py-4" : "py-3"
              }`}
            >
              <ComposerHighlight
                text={draft}
                mode={leadingMode}
                names={skillNames}
                mentions={mentionIndex.labels}
                mcpTags={selectedMcp}
              />
            </div>
            <textarea
              ref={ref}
              data-composer-empty={navigationEmpty ? "true" : undefined}
              style={{ textIndent: modeIndent }}
              rows={1}
              spellCheck
              defaultValue={mountDraft}
              placeholder={
                inboxCard
                  ? t("harness.chrome.placeholderNote")
                  : noteCard
                    ? t("harness.chrome.placeholderMessage")
                    : handoffCard
                      ? t("harness.chrome.placeholderContinue")
                      : shell
                        ? t("harness.chrome.placeholderAskCommands")
                        : t("harness.chrome.placeholderAskSkills")
              }
              className={`composer-field relative max-h-40 w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent px-3 text-sm leading-5.5 outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap font-sans ${
                shell ? "py-4" : "py-3"
              }`}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={(e) => syncHighlightScroll(e.currentTarget)}
              onClick={(e) => syncTokensFromTextarea(e.currentTarget)}
              onKeyUp={(e) => syncTokensFromTextarea(e.currentTarget)}
              onSelect={(e) => syncTokensFromTextarea(e.currentTarget)}
              onInput={(e) => {
                const el = e.currentTarget;
                resizeComposer(el);
                setDraft(el.value);
                setSelectedMcp((current) => {
                  const retained = current.filter(
                    (tag) => taggedMcpServers(el.value, [tag]).length > 0,
                  );
                  return retained.length === current.length
                    ? current
                    : retained;
                });
                syncHasValue(el.value, attachments);
                syncTokensFromTextarea(el);
              }}
            />
          </div>

          <div className="flex items-center gap-1 px-2 pb-2">
            <ToolButton
              label={
                attachmentsSupported
                  ? t("harness.chrome.attachFiles")
                  : t("harness.chrome.fxNoAttachments")
              }
              disabled={!attachmentsSupported}
              onClick={attachFromPicker}
            >
              <Plus className="size-3.5" strokeWidth={1.5} />
            </ToolButton>
            {orchestrationActive ? (
              <ModeCommandPill
                name={ORCHESTRATOR_COMMAND.name}
                onClear={() => {
                  setOrchestrationSelected(false);
                  clearLeadingMode(ORCHESTRATOR_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            {planActive ? (
              <ModeCommandPill
                name={PLAN_COMMAND.name}
                onClear={() => {
                  setPlanSelected(false);
                  clearLeadingMode(PLAN_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            {draftActive ? (
              <ModeCommandPill
                name={DRAFT_COMMAND.name}
                onClear={() => {
                  setDraftSelected(false);
                  clearLeadingMode(DRAFT_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            <div
              className="composer-toolbar flex min-w-0 flex-1 items-center"
              onWheel={(e) => {
                if (
                  e.target instanceof Element &&
                  e.target.closest(
                    "[data-model-picker], [data-access-picker], [data-model-settings]",
                  )
                ) {
                  return;
                }
                const el = e.currentTarget;
                if (el.scrollWidth <= el.clientWidth) return;
                if (e.deltaX === 0 && e.deltaY !== 0) el.scrollLeft += e.deltaY;
              }}
            >
              <div className="flex shrink-0 items-center gap-1">
                <ModelPicker
                  harness={harness}
                  model={model}
                  values={modelSettings}
                  hotkeys={hotkeys && enabled}
                  onChange={onModelChange}
                  onSettingsChange={(settings) =>
                    onModelSettingsChange?.(settings)
                  }
                  onClose={() => ref.current?.focus()}
                />
                {harness !== "fx" ? (
                  <AccessPicker
                    value={runtimeMode}
                    onChange={onRuntimeModeChange}
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
                <NetworkSandboxPicker
                  harness={harness}
                  value={networkSandbox}
                  onChange={(config) => onNetworkSandboxChange?.(config)}
                  onClose={() => ref.current?.focus()}
                />
              </div>
            </div>

            {resendEdited ? (
              <button
                type="button"
                title="Stop editing last message"
                aria-label="Stop editing last message"
                onMouseDown={(event) => event.preventDefault()}
                onClick={exitEditMode}
                className="edit-last-turn-button flex h-6.5 shrink-0 items-center gap-1 rounded-md border border-current/20 px-2 text-[11px] font-medium transition-[background-color,color,border-color] hover:border-current/35 hover:bg-content/15 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <X className="size-3" strokeWidth={1.8} />
                <span>Cancel edit</span>
              </button>
            ) : null}
            <div className="flex shrink-0 items-center gap-1">
              <ComposerAction
                busy={busy}
                hasValue={hasValue}
                label={draftActive ? "Save draft" : undefined}
                onSend={() => submit(ref.current?.value ?? "")}
                onStop={() => onStop?.()}
              />
            </div>
          </div>
        </div>
        {runnerLive && runnerEnabled ? (
          <ComposerRunner
            boxRef={boxRef}
            cwd={cwd}
            busy={busy}
            enabled={enabled}
            onExited={() => setRunnerLive(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ComposerHighlight({
  text,
  mode,
  names,
  mentions,
  mcpTags = [],
}: {
  text: string;
  mode: ModeCommandToken | null;
  names: ReadonlySet<string>;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags?: McpTag[];
}) {
  const rest = mode ? text.slice(mode.end) : text;
  const parts = skillTextParts(rest, names);
  return (
    <>
      {mode ? <ModeCommandText text={text} mode={mode} /> : null}
      {parts.map((part, index) =>
        part.skill ? (
          <span key={index} className="text-skill">
            {part.text}
          </span>
        ) : (
          // Skill tokens always end on whitespace, so each remaining run still
          // starts on a boundary `@mention` matching can rely on.
          <MentionRuns
            key={index}
            text={part.text}
            mentions={mentions}
            mcpTags={mcpTags}
          />
        ),
      )}
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
}

function MentionRuns({
  text,
  mentions,
  mcpTags = [],
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags?: McpTag[];
}) {
  return (
    <>
      {mcpTagParts(text, mcpTags).map((part, index) =>
        part.tag ? (
          <span
            key={index}
            className="text-mention"
            data-mcp-tag={part.tag.token}
          >
            {part.text}
          </span>
        ) : (
          <FileMentionRuns key={index} text={part.text} mentions={mentions} />
        ),
      )}
    </>
  );
}

function FileMentionRuns({
  text,
  mentions,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
}) {
  const parts = fileMentionParts(text, mentions);
  return (
    <>
      {parts.map((part, index) =>
        part.file ? (
          <span key={index} className="text-mention">
            {/* The `@` keeps its width so the textarea underneath stays in
                lockstep; the file icon sits on top of it. */}
            <span className="relative text-transparent">
              {"@"}
              {/* `indent-0`: a leading mode command indents the first line,
                  and this box would otherwise inherit that indent. */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 indent-0">
                {part.file && isNoteMentionPath(part.file.path) ? (
                  <StickyNote className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <FileTypeIcon
                    name={part.file.name}
                    isDir={Boolean(part.file.isDir)}
                    size={13}
                  />
                )}
              </span>
            </span>
            {part.text.slice(1)}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

export function ComposerAction({
  busy,
  disabled = false,
  hasValue,
  label,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled?: boolean;
  hasValue: boolean;
  label?: string;
  onSend: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const sendLabel = label ?? t("harness.chrome.send");
  if (disabled) {
    return (
      <button
        type="button"
        title={sendLabel}
        aria-label={sendLabel}
        disabled
        className="composer-send grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90 disabled:cursor-default disabled:bg-white/30 disabled:text-black/40 disabled:hover:bg-white/30"
      >
        <ArrowUp className="size-3.5" strokeWidth={2.25} />
      </button>
    );
  }
  if (busy) {
    return hasValue ? (
      <button
        type="button"
        title={sendLabel}
        aria-label={sendLabel}
        onClick={onSend}
        className="composer-send grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90"
      >
        <ArrowUp className="size-3.5" strokeWidth={2.25} />
      </button>
    ) : (
      <button
        type="button"
        title={t("harness.chrome.stop")}
        aria-label={t("harness.chrome.stop")}
        onClick={onStop}
        className="grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90"
      >
        <Square className="size-2.5 fill-current" strokeWidth={0} />
      </button>
    );
  }

  return (
    <button
      type="button"
      title={sendLabel}
      aria-label={sendLabel}
      disabled={!hasValue}
      onClick={onSend}
      className="grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90 disabled:cursor-default disabled:bg-white/30 disabled:text-black/40 disabled:hover:bg-white/30"
    >
      <ArrowUp className="size-3.5" strokeWidth={2.25} />
    </button>
  );
}

function hasFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return (
    data.files.length > 0 ||
    [...data.types].some(
      (type) => type === "Files" || type === "application/x-moz-file",
    ) ||
    Array.from(data.items ?? []).some((item) => item.kind === "file")
  );
}
