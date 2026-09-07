import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "@/components/ai-elements/context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { PresenceState } from "@/lib/usePresence";
import { cn } from "@/lib/utils";
import { t, useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { type UIMessage, useChat } from "@ai-sdk/react";
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  Delete02Icon,
  FilterIcon,
  MinusSignIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  estimateCost,
  getModel,
  getModelContextLimit,
  type ModelId,
} from "../config";
import {
  type ConversationEstimateState,
  estimatedTokens,
  updateConversationEstimate,
} from "../lib/conversationPerformance";
import type { ResizeDir } from "../lib/miniWindowGeometry";
import type { SessionMeta } from "../lib/sessions";
import {
  BADGE_MARGIN,
  BADGE_SIZE,
  clampBadgePos,
  getSavedBadgePos,
  saveBadgePos,
  useMiniWindowGeometry,
  viewport,
} from "../lib/useMiniWindowGeometry";
import { useAgentsStore } from "../store/agentsStore";
import { getOrCreateChat } from "../store/chatRuntime";
import { useChatStore } from "../store/chatStore";
import { usePlanStore } from "../store/planStore";
import { AgentSwitcher } from "./AgentSwitcher";
import { AiChatView } from "./AiChat";
import { AiStatusBarControls } from "./AiStatusBarControls";
import { PlanDiffReview } from "./PlanDiffReview";
import { TodoStrip } from "./TodoStrip";

const SUGGESTIONS = [
  {
    label: t("ai.suggestExplainError"),
    hint: t("ai.suggestExplainErrorHint"),
    icon: AlertCircleIcon,
    text: "Explain the last error in the terminal.",
  },
  {
    label: t("ai.suggestGenerateCmd"),
    hint: t("ai.suggestGenerateCmdHint"),
    icon: TerminalIcon,
    text: "Give me a command to ",
  },
  {
    label: t("ai.suggestSummarize"),
    hint: t("ai.suggestSummarizeHint"),
    icon: FilterIcon,
    text: "Summarize what just happened in the terminal.",
  },
];

export function AiMiniWindow({
  state,
  composer,
}: {
  state: PresenceState;
  composer?: ReactNode;
}) {
  const closeMini = useChatStore((s) => s.closeMini);
  const collapseMini = useChatStore((s) => s.collapseMini);
  const openMini = useChatStore((s) => s.openMini);
  const collapsed = useChatStore((s) => s.mini.collapsed);
  const sessionId = useChatStore((s) => s.activeSessionId);
  const openPanel = useChatStore((s) => s.openPanel);
  const expandToPanel = () => {
    closeMini();
    openPanel();
  };

  const { ref, onHeaderPointerDown, startResize, saveCurrentGeom } =
    useMiniWindowGeometry();

  const handleCollapse = useCallback(() => {
    saveCurrentGeom();
    collapseMini();
  }, [saveCurrentGeom, collapseMini]);

  const handleClose = useCallback(() => {
    saveCurrentGeom();
    closeMini();
  }, [saveCurrentGeom, closeMini]);

  if (collapsed) {
    return <AiFloatingBadge onExpand={openMini} />;
  }

  return (
    <div
      ref={ref}
      data-state={state}
      data-ai-mini-window
      data-ai-chat-drop="true"
      className={cn(
        "no-scrollbar-deep fixed z-40 flex flex-col overflow-hidden",
        "rounded-2xl border border-border/60 bg-card text-[12px]",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_24px_48px_-12px_rgba(0,0,0,0.45),0_8px_16px_-8px_rgba(0,0,0,0.3)]",
        "ring-1 ring-black/5 dark:ring-white/5",
        "duration-200 ease-out",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-2",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-foreground/[0.03] to-transparent"
      />
      {RESIZE_DIRS.map((dir) => (
        <ResizeHandle key={dir} dir={dir} onPointerDown={startResize(dir)} />
      ))}
      {sessionId ? (
        <AiChatBody
          sessionId={sessionId}
          onClose={handleClose}
          onCollapse={handleCollapse}
          onExpand={expandToPanel}
          onHeaderPointerDown={onHeaderPointerDown}
        />
      ) : (
        <EmptyShell
          onClose={handleClose}
          onCollapse={handleCollapse}
          onExpand={expandToPanel}
          onHeaderPointerDown={onHeaderPointerDown}
        />
      )}
      {composer}
      <div className="shrink-0 overflow-x-auto border-t border-border/60 bg-foreground/[0.02] px-2 py-1">
        <AiStatusBarControls hidePanelClose compact />
      </div>
      <PlanDiffReview />
    </div>
  );
}

function AiFloatingBadge({ onExpand }: { onExpand: () => void }) {
  const { t } = useTranslation();
  const unreadCount = useChatStore((s) => s.unreadCount);
  const step = useChatStore((s) => s.agentMeta.step);
  const isBusy = step !== null;
  const badgeRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState(() => getSavedBadgePos());

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => {
        const next = clampBadgePos(prev, viewport());
        saveBadgePos(next);
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const gestureRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    didDrag: boolean;
    pointerId: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    gestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      didDrag: false,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (!gesture.didDrag) {
      if (Math.hypot(dx, dy) < 4) return;
      gesture.didDrag = true;
      document.body.style.userSelect = "none";
    }
    const vp = viewport();
    const nx = Math.max(
      BADGE_MARGIN,
      Math.min(vp.vw - BADGE_SIZE - BADGE_MARGIN, gesture.origX + dx),
    );
    const ny = Math.max(
      BADGE_MARGIN,
      Math.min(vp.vh - BADGE_SIZE - BADGE_MARGIN, gesture.origY + dy),
    );
    if (badgeRef.current) {
      badgeRef.current.style.left = `${nx}px`;
      badgeRef.current.style.top = `${ny}px`;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    document.body.style.userSelect = "";
    try {
      e.currentTarget.releasePointerCapture(gesture.pointerId);
    } catch {
      // fallback if capture already released
    }
    if (gesture.didDrag) {
      const el = badgeRef.current;
      if (el) {
        const nx = parseFloat(el.style.left) || pos.x;
        const ny = parseFloat(el.style.top) || pos.y;
        const nextPos = { x: nx, y: ny };
        setPos(nextPos);
        saveBadgePos(nextPos);
      }
    } else {
      onExpand();
    }
  };

  return (
    <div
      ref={badgeRef}
      role="button"
      tabIndex={0}
      data-ai-mini-window-trigger
      data-ai-floating-badge
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExpand();
        }
      }}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      aria-label={t("ai.openAgent")}
      title={t("ai.openAgent")}
      className={cn(
        "fixed z-40 flex size-12 cursor-grab select-none items-center justify-center",
        "rounded-2xl border border-border/80 bg-card/95 p-2 shadow-2xl backdrop-blur-md",
        "transition-transform active:cursor-grabbing hover:scale-105 active:scale-95",
        "ring-1 ring-black/10 dark:ring-white/10",
        "animate-in fade-in-0 zoom-in-90 duration-150",
      )}
    >
      <img
        src="/voktty.svg"
        alt="Voktty AI"
        className="size-7 pointer-events-none select-none drop-shadow"
      />

      {isBusy && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -m-0.5 animate-ping rounded-2xl border border-primary/40"
        />
      )}

      {unreadCount > 0 && (
        <span
          aria-hidden
          className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground shadow-md"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </div>
  );
}

const RESIZE_HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "top-0 left-3 right-3 h-1.5 cursor-ns-resize",
  s: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize",
  w: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize",
  e: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
};

const RESIZE_DIRS: ResizeDir[] = ["n", "s", "w", "e", "nw", "ne", "sw", "se"];

function ResizeHandle({
  dir,
  onPointerDown,
}: {
  dir: ResizeDir;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-no-drag
      onPointerDown={onPointerDown}
      className={cn(
        "absolute z-50 touch-none select-none",
        RESIZE_HANDLE_CLASS[dir],
      )}
    />
  );
}

export function AiChatBody({
  sessionId,
  onClose,
  onCollapse,
  onExpand,
  onHeaderPointerDown,
  sidebar = false,
}: {
  sessionId: string;
  onClose: () => void;
  onCollapse?: () => void;
  onExpand: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
  sidebar?: boolean;
}) {
  const focusInput = useChatStore((s) => s.focusInput);
  const step = useChatStore((s) => s.agentMeta.step);

  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });
  const isBusy =
    helpers.status === "submitted" || helpers.status === "streaming";

  return (
    <>
      <Header
        sessionId={sessionId}
        step={step}
        isBusy={isBusy}
        onClose={onClose}
        onCollapse={onCollapse}
        onExpand={onExpand}
        messages={helpers.messages}
        onHeaderPointerDown={onHeaderPointerDown}
        isSidebar={sidebar}
      />

      <PlanModeStrip />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {helpers.messages.length === 0 ? (
          <EmptyState onPick={focusInput} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[12px] [&_p]:leading-relaxed">
            <AiChatView
              sessionId={sessionId}
              messages={helpers.messages}
              status={helpers.status}
              error={helpers.error}
              clearError={helpers.clearError}
              addToolApprovalResponse={helpers.addToolApprovalResponse}
              stop={helpers.stop}
            />
          </div>
        )}
      </div>

      <TodoStrip sessionId={sessionId} />
    </>
  );
}

function PlanModeStrip() {
  const { t } = useTranslation();
  const active = usePlanStore((s) => s.active);
  const queueLen = usePlanStore((s) => s.queue.length);
  const disable = usePlanStore((s) => s.disable);
  if (!active) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/40 px-3 py-1.5">
      <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="text-[11px] font-medium text-foreground">
        {t("ai.planMode")}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {queueLen > 0
          ? t("ai.planQueued", { count: queueLen })
          : t("ai.planNoEdits")}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => disable()}
        className="rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {t("ai.planExit")}
      </button>
    </div>
  );
}

function EmptyShell({
  onClose,
  onCollapse,
  onExpand,
  onHeaderPointerDown,
}: {
  onClose: () => void;
  onCollapse?: () => void;
  onExpand: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Header
        step={null}
        isBusy={false}
        onClose={onClose}
        onCollapse={onCollapse}
        onExpand={onExpand}
        onHeaderPointerDown={onHeaderPointerDown}
      />
      <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
        {t("ai.loadingSessions")}
      </div>
    </>
  );
}

function Header({
  sessionId,
  step,
  isBusy,
  onClose,
  onCollapse,
  messages,
  onHeaderPointerDown,
  isSidebar = false,
}: {
  sessionId?: string;
  step: string | null;
  isBusy: boolean;
  onClose: () => void;
  onCollapse?: () => void;
  onExpand: () => void;
  messages?: UIMessage[];
  onHeaderPointerDown: (e: React.PointerEvent) => void;
  isSidebar?: boolean;
}) {
  const { t } = useTranslation();
  const customAgents = useAgentsStore((s) => s.customAgents);
  void customAgents;

  return (
    <div
      onPointerDown={isSidebar ? undefined : onHeaderPointerDown}
      className={cn(
        "relative flex h-10 shrink-0 items-center justify-between gap-1.5 border-b border-border/60 px-2.5 overflow-hidden select-none",
        !isSidebar && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <AgentSwitcher isMiniWindow={!isSidebar} />
        <SessionPicker />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isBusy ? (
          <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            <Spinner className="size-2.5" />
            <span className="max-w-20 truncate">
              {step ?? t("ai.thinking")}
            </span>
          </span>
        ) : null}
        {messages !== undefined && sessionId ? (
          <ContextIndicator sessionId={sessionId} messages={messages} />
        ) : null}
        {onCollapse && !isSidebar ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onCollapse}
            className="size-6 rounded-md text-muted-foreground hover:text-foreground"
            aria-label={t("ai.collapseToBadge", {
              defaultValue: "Minimizar a icono flotante",
            })}
            title={t("ai.collapseToBadge", {
              defaultValue: "Minimizar a icono flotante",
            })}
          >
            <HugeiconsIcon icon={MinusSignIcon} size={12} strokeWidth={1.75} />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="size-6 rounded-md text-muted-foreground hover:text-foreground"
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function ContextIndicator({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UIMessage[];
}) {
  const { t } = useTranslation();
  const modelId = useChatStore((s) => s.selectedModelId);
  const tokens = useChatStore((s) => s.agentMeta.tokens);
  const lastInput = useChatStore((s) => s.agentMeta.lastInputTokens);
  const lastCached = useChatStore((s) => s.agentMeta.lastCachedTokens);
  const estimateRef = useRef<ConversationEstimateState | null>(null);
  const estimated = useMemo(() => {
    const next = updateConversationEstimate(
      estimateRef.current,
      sessionId,
      messages,
    );
    estimateRef.current = next;
    return estimatedTokens(next);
  }, [messages, sessionId]);
  const used = lastInput > 0 ? lastInput : estimated;
  const reported = tokens.inputTokens + tokens.outputTokens;
  const openaiCompatibleContextLimit = usePreferencesStore(
    (s) => s.openaiCompatibleContextLimit,
  );
  const max = getModelContextLimit(modelId, openaiCompatibleContextLimit);
  const modelLabel = useMemo(() => {
    try {
      return getModel(modelId as ModelId).label;
    } catch {
      return modelId;
    }
  }, [modelId]);
  const cost = estimateCost(modelId, tokens);
  const cacheRate =
    tokens.inputTokens > 0
      ? Math.round((tokens.cachedInputTokens / tokens.inputTokens) * 100)
      : 0;

  return (
    <Context usedTokens={used} maxTokens={max}>
      <ContextTrigger className="h-6 gap-1 px-1.5 text-[10.5px] rounded-md" />
      <ContextContent className="w-64 text-[11px]">
        <ContextContentHeader />
        <ContextContentBody>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t("ai.contextModel")}</span>
            <span className="font-mono text-foreground">{modelLabel}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-muted-foreground">
            <span>
              {lastInput > 0
                ? t("ai.contextLastRequest")
                : t("ai.contextEstimated")}
            </span>
            <span className="font-mono text-foreground">
              {formatTokens(used)}
            </span>
          </div>
          {lastCached > 0 && (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{t("ai.contextCached")}</span>
              <span className="font-mono text-foreground">
                {formatTokens(lastCached)}
              </span>
            </div>
          )}
          {reported > 0 && (
            <>
              <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
                <span>{t("ai.contextSessionInput")}</span>
                <span className="font-mono text-foreground">
                  {formatTokens(tokens.inputTokens)}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t("ai.contextSessionOutput")}</span>
                <span className="font-mono text-foreground">
                  {formatTokens(tokens.outputTokens)}
                </span>
              </div>
              {tokens.cachedInputTokens > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>{t("ai.contextCacheHit")}</span>
                  <span className="font-mono text-foreground">
                    {cacheRate}%
                  </span>
                </div>
              )}
              {cost != null && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>{t("ai.contextSessionCost")}</span>
                  <span className="font-mono text-foreground">
                    ${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t("ai.contextWindow")}</span>
            <span className="font-mono text-foreground">
              {formatTokens(max)}
            </span>
          </div>
        </ContextContentBody>
        <ContextContentFooter>
          <span className="text-[10px] italic text-muted-foreground">
            {lastInput > 0
              ? t("ai.contextFooterReported")
              : t("ai.contextFooterEstimated")}
          </span>
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}

function SessionPicker() {
  const { t } = useTranslation();
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  if (!active) return null;

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 max-w-24 sm:max-w-36 items-center gap-1 rounded-md px-1.5 py-0.5",
            "text-[10.5px] text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground shrink-0",
          )}
          title={t("ai.switchSession")}
        >
          <span className="truncate">{active.title || t("ai.newChat")}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className="opacity-70 shrink-0"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem
          onSelect={() => newSession()}
          className="gap-2 text-xs"
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
          {t("ai.newSessionLabel")}
        </DropdownMenuItem>
        {sorted.length > 0 ? <DropdownMenuSeparator /> : null}
        {sorted.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={() => switchSession(s.id)}
            onDelete={() => deleteSession(s.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        // Don't dismiss if user clicked the trash icon - handle below.
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-session-delete]")) {
          e.preventDefault();
          return;
        }
        onSelect();
      }}
      className={cn(
        "group flex items-center justify-between gap-2 text-xs",
        active && "bg-accent/40",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {session.title || t("ai.newChat")}
      </span>
      <button
        type="button"
        data-session-delete
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t("ai.deleteSession")}
        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
      </button>
    </DropdownMenuItem>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6 text-center max-w-sm mx-auto my-auto w-full">
      <img src="/voktty.svg" alt="Voktty" className="size-12 opacity-90" />
      <div className="space-y-1">
        <p className="text-[13.5px] font-semibold tracking-tight">
          {t("ai.emptyTitle")}
        </p>
        <p className="max-w-[18rem] text-[11px] leading-relaxed text-muted-foreground">
          {t("ai.emptyStateDesc")}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.text)}
            className={cn(
              "group flex items-center gap-2.5 bg-card/70 rounded-lg px-2.5 py-1.5 border border-border text-left",
              "transition-colors hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground transition-colors group-hover:bg-foreground/5 group-hover:text-foreground">
              <HugeiconsIcon icon={s.icon} size={12} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-medium text-foreground">
                {s.label}
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {s.hint}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
