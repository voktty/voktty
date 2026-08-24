import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Hammer,
  Search,
  Terminal,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AttachmentChip } from "../chrome/AttachmentChip";
import { FilePreview } from "../chrome/FilePreview";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { PlanPreview } from "../chrome/PlanPreview";
import { TerminalSpinner } from "../chrome/TerminalSpinner";
import type { ApprovalDecision } from "../lib/harness";
import {
  isEditTool,
  isReadTool,
  isSearchTool,
  stubFilePreview,
} from "../lib/harness/preview";
import { displayPath, resolveWorkspacePath } from "../lib/paths";
import { Shimmer } from "./Shimmer";
import {
  hasPendingApproval,
  HARNESS_TITLE,
  type Block,
  type ToolPreview,
} from "../lib/session";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { AgentMarkdown } from "./AgentMarkdown";
import {
  groupTurnItems,
  groupTurns,
  isIncompleteTool,
  needsApproval,
  splitActivityRows,
  toolCallLabel,
  toolCallState,
  type ToolCallState,
} from "./transcriptActivity";

const NEAR_BOTTOM_PX = 16;
const INITIAL_TURNS = 20;
const TURN_PAGE_SIZE = 20;

type Props = {
  blocks: Block[];
  busy?: boolean;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onJumpToBottomChange?: (show: boolean) => void;
  onJumpToBottomReady?: (jump: () => void) => void;
};

export function AgentTranscript({
  blocks,
  busy,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onJumpToBottomChange,
  onJumpToBottomReady,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const showJumpRef = useRef(false);
  const distanceFromBottom = useRef(0);
  const prependHeight = useRef<number | null>(null);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_TURNS);
  const lastUserId = lastUserBlockId(blocks);
  const liveStartedAt = turnUserBlock(blocks)?.startedAt;
  const waitingForApproval = hasPendingApproval(blocks);
  const preparingHandoff = blocks.some(
    (block) =>
      block.role === "handoff" && block.handoff?.status === "preparing",
  );

  const setShowJump = useCallback(
    (show: boolean) => {
      if (showJumpRef.current === show) return;
      showJumpRef.current = show;
      onJumpToBottomChange?.(show);
    },
    [onJumpToBottomChange],
  );

  const syncPinned = useCallback(
    (el: HTMLElement) => {
      const near = isNearBottom(el);
      stickToBottom.current = near;
      distanceFromBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJump(!near);
    },
    [setShowJump],
  );

  const jumpToBottom = useCallback(() => {
    stickToBottom.current = true;
    distanceFromBottom.current = 0;
    setShowJump(false);
    pinToBottom(scroller.current);
  }, [setShowJump]);

  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      setScrollerEl(el);
      lockOverscroll(el);
    },
    [lockOverscroll],
  );

  useEffect(() => {
    onJumpToBottomReady?.(jumpToBottom);
  }, [jumpToBottom, onJumpToBottomReady]);

  useEffect(() => {
    if (!scrollerEl) return;
    syncPinned(scrollerEl);
    const onScroll = () => syncPinned(scrollerEl);
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        stickToBottom.current = false;
        setShowJump(true);
      }
    };
    scrollerEl.addEventListener("scroll", onScroll, { passive: true });
    scrollerEl.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      scrollerEl.removeEventListener("scroll", onScroll);
      scrollerEl.removeEventListener("wheel", onWheel);
    };
  }, [scrollerEl, setShowJump, syncPinned]);

  useLayoutEffect(() => {
    stickToBottom.current = true;
    setShowJump(false);
    pinToBottom(scroller.current);
  }, [lastUserId, setShowJump]);

  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    pinToBottom(scroller.current);
  }, [blocks, busy]);

  useEffect(() => {
    const el = scrollerEl;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (stickToBottom.current) {
        pinToBottom(el);
        distanceFromBottom.current = 0;
        return;
      }
      distanceFromBottom.current = distance;
      setShowJump(!isNearBottom(el));
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [scrollerEl, setShowJump]);

  const turns = groupTurns(blocks);
  const firstVisibleTurn = Math.max(0, turns.length - visibleTurnCount);
  const visibleTurns = turns.slice(firstVisibleTurn);

  useLayoutEffect(() => {
    const previousHeight = prependHeight.current;
    const el = scroller.current;
    if (previousHeight == null || !el) return;
    prependHeight.current = null;
    el.scrollTop += el.scrollHeight - previousHeight;
    distanceFromBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight;
  }, [visibleTurnCount]);

  const loadEarlier = () => {
    const el = scroller.current;
    if (el) prependHeight.current = el.scrollHeight;
    stickToBottom.current = false;
    setVisibleTurnCount((count) =>
      Math.min(turns.length, count + TURN_PAGE_SIZE),
    );
  };

  return (
    <div
      ref={setScroller}
      className="agent-transcript h-full overflow-y-auto overscroll-none [overflow-anchor:none] font-mono text-[13px] leading-5"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-1">
        {firstVisibleTurn > 0 ? (
          <div className="flex justify-center px-4 py-3">
            <button
              type="button"
              className="rounded-md bg-content/8 px-2.5 py-1.5 font-sans text-[12px] text-content/60 hover:bg-content/12 hover:text-content"
              onClick={loadEarlier}
            >
              Load earlier messages
            </button>
          </div>
        ) : null}
        {visibleTurns.map((turn, turnIndex) => {
          const isLastTurn = firstVisibleTurn + turnIndex === turns.length - 1;
          const durationMs = turnUserBlock(turn)?.durationMs;
          return (
            <div
              key={turn[0].id}
              className="transcript-turn flex flex-col gap-1"
            >
              {groupTurnItems(turn).map((item) =>
                item.type === "activity" ? (
                  <ActivityGroup
                    key={item.blocks[0].id}
                    blocks={item.blocks}
                    cwd={cwd}
                    onApproval={onApproval}
                    onOpenFile={onOpenFile}
                  />
                ) : (
                  <TranscriptBlock
                    key={item.block.id}
                    block={item.block}
                    stickyIndex={firstVisibleTurn + turnIndex + 1}
                    onApproval={onApproval}
                    onOpenFile={onOpenFile}
                    onOpenDiff={onOpenDiff}
                    onOpenPlan={onOpenPlan}
                    cwd={cwd}
                  />
                ),
              )}
              {durationMs != null && !(busy && isLastTurn) ? (
                <TurnDuration elapsedMs={durationMs} done />
              ) : null}
            </div>
          );
        })}
        {busy && !preparingHandoff ? (
          <LiveWorking startedAt={liveStartedAt} paused={waitingForApproval} />
        ) : null}
      </div>
    </div>
  );
}

function LiveWorking({
  startedAt,
  paused,
}: {
  startedAt?: number;
  paused: boolean;
}) {
  const elapsedMs = useElapsedFrom(startedAt, paused);
  if (paused) return null;
  return <TurnDuration elapsedMs={elapsedMs} live />;
}

function TurnDuration({
  elapsedMs,
  live = false,
  done = false,
}: {
  elapsedMs: number | null;
  live?: boolean;
  done?: boolean;
}) {
  const label = formatWorkingDuration(elapsedMs, done);
  return (
    <div
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      aria-label={live ? "Agent is working" : label}
      className="flex items-center gap-2 px-4 py-3 font-sans text-sm text-content/40"
    >
      {done ? (
        <Check className="size-3.5" strokeWidth={1.75} />
      ) : (
        <TerminalSpinner />
      )}

      {live && !done ? (
        <Shimmer duration={1}>{label}</Shimmer>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

const TranscriptBlock = memo(function TranscriptBlock({
  block,
  stickyIndex,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
}: {
  block: Block;
  stickyIndex: number;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
}) {
  if (block.role === "user") {
    return <UserMessageBlock block={block} stickyIndex={stickyIndex} />;
  }

  if (block.role === "tool") {
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "reasoning") {
    return null;
  }

  if (block.role === "plan") {
    return (
      <div className="px-4 py-1">
        <PlanPreview
          text={block.text}
          streaming={block.streaming}
          onOpen={onOpenPlan ? () => onOpenPlan(block.id) : undefined}
        />
      </div>
    );
  }

  if (block.role === "approval") {
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "handoff") {
    return <HandoffDivider block={block} />;
  }

  if (block.role === "system") {
    return (
      <div className="px-4 py-2 text-content/50">
        <pre className="min-w-0 whitespace-pre-wrap break-words">
          {block.text}
        </pre>
      </div>
    );
  }

  if (!block.text && block.streaming) return null;

  return (
    <div className="px-4 py-3 text-content">
      <AgentMarkdown
        text={block.text}
        streaming={block.streaming}
        cwd={cwd}
        onOpenFile={onOpenFile}
      />
    </div>
  );
});

function UserMessageBlock({
  block,
  stickyIndex,
}: {
  block: Block;
  stickyIndex: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);
  const text = block.text;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !text) {
      setOverflows(false);
      return;
    }
    if (expanded) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  const toggle = () => {
    if (overflows) setExpanded((value) => !value);
  };

  return (
    <div className="p-1.5 pb-0">
      <div
        className={`rounded-lg border-content/10 px-3 py-2 text-content border bg-content/10`}
        style={{ zIndex: stickyIndex }}
        onClick={overflows ? toggle : undefined}
      >
        {block.attachments?.length ? (
          <div className={`flex flex-wrap gap-1.5 ${text ? "mb-2" : ""}`}>
            {block.attachments.map((file) => (
              <AttachmentChip key={file.id} attachment={file} />
            ))}
          </div>
        ) : null}
        {text ? (
          <pre
            ref={textRef}
            className={`min-w-0 whitespace-pre-wrap break-words font-sans text-sm ${expanded ? "" : "line-clamp-4"}`}
          >
            {text}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function ActivityGroup({
  blocks,
  cwd,
  onApproval,
  onOpenFile,
}: {
  blocks: Block[];
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { latest, pending, hidden } = splitActivityRows(blocks);

  return (
    <div className="flex flex-col gap-0.5 px-4">
      {latest ? (
        <ActivityToolRow
          block={latest}
          cwd={cwd}
          onApproval={onApproval}
          onOpenFile={onOpenFile}
        />
      ) : null}
      {pending.map((block) => (
        <ActivityToolRow
          key={block.id}
          block={block}
          cwd={cwd}
          onApproval={onApproval}
          onOpenFile={onOpenFile}
        />
      ))}
      {hidden.length > 0 ? (
        expanded ? (
          <div className="flex flex-col gap-0.5">
            {[...hidden].reverse().map((block) => (
              <ActivityToolRow
                key={block.id}
                block={block}
                cwd={cwd}
                onOpenFile={onOpenFile}
              />
            ))}
            <button
              type="button"
              aria-expanded
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1.5 py-1 font-sans text-sm text-content/40 hover:text-content/55"
            >
              <ChevronDown className="size-3.5 shrink-0 rotate-180" />
              <span>Hide previous</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={false}
            aria-label={`Show ${hidden.length} previous tool calls`}
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1.5 py-1 font-sans text-sm text-content/40 hover:text-content/55"
          >
            <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              +{hidden.length} previous{" "}
              {hidden.length === 1 ? "tool call" : "tool calls"}
            </span>
          </button>
        )
      ) : null}
    </div>
  );
}

function ActivityToolRow({
  block,
  cwd,
  onApproval,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
}) {
  const label = toolCallLabel(block, cwd);
  const state = toolCallState(block);
  const pending = needsApproval(block);

  return (
    <div className="flex min-w-0 flex-col">
      <div
        aria-label={`Tool call: ${label}`}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        <ActivityToolIcon block={block} state={state} />
        <ToolCallSummary
          label={label}
          preview={block.tool?.preview}
          cwd={cwd}
          onOpenFile={onOpenFile}
        />
        {pending ? null : <ToolCallStatusIcon state={state} />}
      </div>
      {pending ? (
        <ApprovalControls block={block} onApproval={onApproval} />
      ) : null}
    </div>
  );
}

function ActivityToolIcon({
  block,
  state,
}: {
  block: Block;
  state: ToolCallState;
}) {
  if (state === "pending") {
    return (
      <CircleDashed
        className="size-3.5 shrink-0 text-content/40"
        strokeWidth={1.75}
      />
    );
  }

  const kind = block.tool?.preview?.kind ?? block.tool?.kind?.toLowerCase();
  const label = block.text || block.tool?.title || "";
  const className = "size-3.5 shrink-0 text-content/50";

  if (
    kind === "shell" ||
    /^(run|ran)\s+command/i.test(label) ||
    /shell|bash|execute/i.test(block.tool?.kind ?? "")
  ) {
    return <Terminal className={className} strokeWidth={1.75} />;
  }
  if (
    kind === "read" ||
    isReadTool(block.tool?.kind, label, block.tool?.preview)
  ) {
    return <Hammer className={className} strokeWidth={1.75} />;
  }
  if (
    kind === "search" ||
    isSearchTool(block.tool?.kind, label, block.tool?.preview)
  ) {
    return <Search className={className} strokeWidth={1.75} />;
  }

  return <Hammer className={className} strokeWidth={1.75} />;
}

function ToolCallStatusIcon({ state }: { state: ToolCallState }) {
  const className = "size-3.5 shrink-0";
  if (state === "accepted") {
    return (
      <Check className={`${className} text-content/35`} strokeWidth={2.25} />
    );
  }
  if (state === "rejected") {
    return <X className={`${className} text-red-400`} strokeWidth={2} />;
  }
  return null;
}

function useElapsedFrom(
  startedAt: number | undefined,
  paused: boolean,
): number | null {
  const fallback = useRef<number | null>(null);
  const pausedMs = useRef(0);
  const pauseStarted = useRef<number | null>(null);
  const seenStartedAt = useRef(startedAt);

  if (seenStartedAt.current !== startedAt) {
    seenStartedAt.current = startedAt;
    fallback.current = null;
    pausedMs.current = 0;
    pauseStarted.current = paused ? Date.now() : null;
  }

  const origin = startedAt ?? (fallback.current ??= Date.now());
  const [elapsedMs, setElapsedMs] = useState(() =>
    Math.max(0, Date.now() - origin),
  );

  useEffect(() => {
    const start = startedAt ?? (fallback.current ??= Date.now());
    if (paused) {
      if (pauseStarted.current == null) pauseStarted.current = Date.now();
      return;
    }
    if (pauseStarted.current != null) {
      pausedMs.current += Date.now() - pauseStarted.current;
      pauseStarted.current = null;
    }
    const tick = () =>
      setElapsedMs(Math.max(0, Date.now() - start - pausedMs.current));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, paused]);

  return elapsedMs;
}

function formatWorkingDuration(elapsedMs: number | null, done = false): string {
  if (elapsedMs == null) return done ? "Worked" : "Working…";
  const totalSec = Math.max(1, Math.round(elapsedMs / 1000));
  const label = done ? "Worked for" : "Working for";
  if (totalSec < 60) return `${label} ${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${label} ${minutes}m ${seconds}s` : `${label} ${minutes}m`;
}

function ToolCall({
  block,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  embedded,
}: {
  block: Block;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = block.tool?.preview;
  const label = toolCallLabel(block, cwd);
  const detail = block.tool?.detail?.trim();
  const expanded = detail && detail !== label ? detail : label;
  const state = toolCallState(block);
  const stateLabel =
    state === "accepted"
      ? "Accepted"
      : state === "rejected"
        ? "Rejected"
        : "Pending";
  const editTool = isEditTool(
    block.tool?.kind,
    block.text || block.tool?.title,
    preview,
  );
  const compact =
    isReadTool(block.tool?.kind, label, preview) ||
    isSearchTool(block.tool?.kind, label, preview);
  const expandable = !compact && !!detail && detail !== label;

  const frame = embedded ? "py-0.5" : "px-4 py-1";

  if (editTool) {
    return (
      <div className={frame}>
        <FilePreview
          preview={preview ?? stubFilePreview(block.tool?.kind, label)}
          status={state}
          cwd={cwd}
          onOpenFile={onOpenDiff ?? onOpenFile}
        />
        <ApprovalControls block={block} onApproval={onApproval} />
      </div>
    );
  }

  if (isIncompleteTool(block, label, state)) return null;

  return (
    <div className={frame}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${stateLabel} tool call: ${label}`}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 text-left"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            preview={preview}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
          <ChevronRight
            className={`size-3.5 shrink-0 text-content/35 transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.75}
          />
        </button>
      ) : (
        <div
          aria-label={`${stateLabel} tool call: ${label}`}
          className="flex w-full min-w-0 items-center gap-2"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            preview={preview}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
      {open && expandable ? (
        <pre className="mt-1.5 min-w-0 whitespace-pre-wrap break-words px-2.5 font-mono text-[12px] leading-5 text-content/55">
          {expanded}
        </pre>
      ) : null}
      <ApprovalControls block={block} onApproval={onApproval} />
    </div>
  );
}

function ToolCallSummary({
  label,
  preview,
  cwd,
  onOpenFile,
  interactive = true,
}: {
  label: string;
  preview?: ToolPreview;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  interactive?: boolean;
}) {
  const parts = label.match(/^(Read|Find)\s+(.+)$/);
  const action = parts?.[1]
    ?? (/^read$/i.test(label.trim()) && (preview?.path || preview?.fileName)
      ? "Read"
      : /^find$/i.test(label.trim()) && preview?.query
        ? "Find"
        : undefined);
  const target = parts?.[2]
    ?? (action === "Read"
      ? (preview?.path ? displayPath(preview.path, cwd) : preview?.fileName)
      : action === "Find"
        ? preview?.query
        : undefined);
  if (!action || !target) {
    return (
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-content/80">
        {label}
      </span>
    );
  }
  const isFile = action === "Read";
  const fileName =
    preview?.fileName ||
    target
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() ||
    "file";
  const filePath = resolveWorkspacePath(preview?.path || target, cwd);
  const canOpen = interactive && !!onOpenFile && !!filePath;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[13px]">
      <span className="shrink-0 text-content/50 font-sans text-sm">
        {action}
      </span>
      {isFile ? (
        canOpen ? (
          <button
            type="button"
            className="-my-0.5 flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-content/85 hover:text-sky-300 hover:underline"
            title={preview?.path || target}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile?.(filePath);
            }}
          >
            <FileTypeIcon name={fileName} isDir={false} />
            <span className="min-w-0 truncate">{target}</span>
          </button>
        ) : (
          <span
            className="flex min-w-0 flex-1 items-center gap-1 px-1 text-content/85"
            title={preview?.path || target}
          >
            <FileTypeIcon name={fileName} isDir={false} />
            <span className="min-w-0 truncate">{target}</span>
          </span>
        )
      ) : (
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 text-content/85 pl-1"
          title={target}
        >
          <span className="min-w-0 truncate">{target}</span>
        </span>
      )}
    </span>
  );
}

function ToolCallIcon({ state }: { state: ToolCallState }) {
  const className = "size-3.5 shrink-0";
  if (state === "accepted") {
    return (
      <Check className={`${className} text-teal-400`} strokeWidth={2.25} />
    );
  }
  if (state === "rejected") {
    return <X className={`${className} text-red-400`} strokeWidth={2} />;
  }
  return (
    <CircleDashed
      className={`${className} text-content/40`}
      strokeWidth={1.75}
    />
  );
}

function ApprovalControls({
  block,
  onApproval,
}: {
  block: Block;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const approval = block.approval;
  if (!approval || approval.decided) return null;
  return (
    <div className="mt-1.5 flex gap-2">
      <button
        type="button"
        className="rounded-md bg-content px-2.5 py-0.5 text-[11px] hover:bg-content/80     text-background-base"
        onClick={() => onApproval?.(approval.requestId, "allow")}
      >
        Allow
      </button>
      <button
        type="button"
        className="rounded-md bg-content/10 px-2.5 py-0.5 text-[11px] text-content/70 hover:bg-content/20"
        onClick={() => onApproval?.(approval.requestId, "deny")}
      >
        Deny
      </button>
    </div>
  );
}

function HandoffDivider({ block }: { block: Block }) {
  const meta = block.handoff;
  if (!meta) return null;

  const preparing = meta.status === "preparing";
  const label = preparing
    ? "Preparing a handoff"
    : HARNESS_TITLE[meta.to];

  return (
    <div className="px-4 py-5">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-content/12" />
        <div
          role="separator"
          aria-label={
            preparing
              ? `Preparing a handoff to ${HARNESS_TITLE[meta.to]}`
              : `Continued with ${label}`
          }
          className="flex max-w-[min(100%,20rem)] items-center gap-1.5 px-1.5 font-sans text-[12px] text-content/55"
        >
          {preparing ? (
            <>
              <TerminalSpinner className="inline-block w-3.5 shrink-0 select-none text-center text-[11px] leading-none text-content/45" />
              <Shimmer duration={1.4}>{label}</Shimmer>
            </>
          ) : (
            <>
              <HarnessIcon harness={meta.to} className="size-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </>
          )}
        </div>
        <div className="h-px min-w-4 flex-1 bg-content/12" />
      </div>
    </div>
  );
}

function lastUserBlockId(blocks: Block[]): string | undefined {
  return turnUserBlock(blocks)?.id;
}

function turnUserBlock(blocks: Block[]): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user") return blocks[i];
  }
  return undefined;
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function pinToBottom(el: HTMLElement | null) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}
