import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { useDraggableModal } from "@/hooks/useDraggableModal";
import { cn } from "@/lib/utils";
import { createDomSearchController, type DomSearchMatchInfo } from "@/modules/markdown/lib/domSearch";
import { getActiveTerminalLeafId, submitToLeaf } from "@/modules/terminal/lib/useTerminalSession";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  SquareIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { exportSessionMarkdown, getResumeCommand } from "../lib/agentHistoryBridge";
import { useTranslation } from "@/modules/i18n";
import { useAgentHistoryStore } from "../store/agentHistoryStore";
import type { HistorySession } from "../types";

const AGENT_BADGES: Record<string, { bg: string; color: string; i18nKey: string }> = {
  claude: { bg: "bg-purple-500/15", color: "text-purple-400", i18nKey: "claude" },
  codex: { bg: "bg-emerald-500/15", color: "text-emerald-400", i18nKey: "codex" },
  cursor: { bg: "bg-sky-500/15", color: "text-sky-400", i18nKey: "cursor" },
  voktty: { bg: "bg-blue-500/15", color: "text-blue-400", i18nKey: "voktty" },
  gemini: { bg: "bg-amber-500/15", color: "text-amber-400", i18nKey: "gemini" },
  kimi: { bg: "bg-teal-500/15", color: "text-teal-400", i18nKey: "kimi" },
};

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 700;
const MIN_WIDTH = 680;
const MIN_HEIGHT = 450;

export function AgentHistoryModal() {
  const {
    isOpen,
    closeHistory,
    sessions,
    activeSessionId,
    activeSession,
    messages,
    isLoading,
    isScanning,
    searchQuery,
    selectedAgent,
    stats,
    setSearchQuery,
    setSelectedAgent,
    selectSession,
    rescan,
    deleteSession,
  } = useAgentHistoryStore();

  const { t } = useTranslation();
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  // In-transcript Ctrl+F search state
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatchInfo, setFindMatchInfo] = useState<DomSearchMatchInfo>({ current: 0, total: 0 });

  const [size, setSize] = useState({
    width: typeof window !== "undefined" ? Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 80)) : DEFAULT_WIDTH,
    height: typeof window !== "undefined" ? Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 80)) : DEFAULT_HEIGHT,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const searchControllerRef = useRef<ReturnType<typeof createDomSearchController> | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { position, dragHandleProps, resetPosition, setPosition } = useDraggableModal({
    resetOnClose: true,
  });

  // Debounced session list search
  const handleSearchChange = (val: string) => {
    setLocalSearch(val);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setSearchQuery(val);
    }, 150);
  };

  const handleClearSearch = () => {
    setLocalSearch("");
    setSearchQuery("");
  };

  // In-transcript search controller lifecycle
  useEffect(() => {
    if (transcriptRef.current && activeSession) {
      searchControllerRef.current = createDomSearchController(transcriptRef.current);
    }
    return () => {
      searchControllerRef.current?.clearQuery();
      searchControllerRef.current = null;
    };
  }, [activeSession, messages]);

  const handleFindChange = (q: string) => {
    setFindQuery(q);
    if (searchControllerRef.current) {
      const match = searchControllerRef.current.setQuery(q);
      setFindMatchInfo(match);
    }
  };

  const handleFindNext = () => {
    if (searchControllerRef.current) {
      const match = searchControllerRef.current.findNext();
      setFindMatchInfo(match);
    }
  };

  const handleFindPrev = () => {
    if (searchControllerRef.current) {
      const match = searchControllerRef.current.findPrevious();
      setFindMatchInfo(match);
    }
  };

  const closeFind = useCallback(() => {
    setIsFindOpen(false);
    setFindQuery("");
    setFindMatchInfo({ current: 0, total: 0 });
    searchControllerRef.current?.clearQuery();
  }, []);

  // Resizing handler with pointer capture
  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = size.width;
    const startHeight = size.height;

    const onPointerMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;

      const maxW = window.innerWidth - 32;
      const maxH = window.innerHeight - 32;

      setSize({
        width: Math.max(MIN_WIDTH, Math.min(maxW, startWidth + deltaX)),
        height: Math.max(MIN_HEIGHT, Math.min(maxH, startHeight + deltaY)),
      });
    };

    const onPointerUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [size, isMaximized]);

  const toggleMaximize = useCallback(() => {
    setIsMaximized((prev) => {
      const next = !prev;
      if (next) {
        setPosition({ x: 0, y: 0 });
      }
      return next;
    });
  }, [setPosition]);

  // Terminal Resume Actions
  const handleResumeInTerminal = useCallback(async (session: HistorySession) => {
    const cmd = await getResumeCommand(session.id);
    if (!cmd) {
      toast.error(t("agentHistory.noResumeAvailable"));
      return;
    }

    const leafId = getActiveTerminalLeafId();
    if (leafId !== null) {
      submitToLeaf(leafId, cmd);
      toast.success(t("agentHistory.resumedInTerminal"), { description: cmd });
      closeHistory();
    } else {
      await navigator.clipboard.writeText(cmd);
      toast.success(t("agentHistory.resumeCommandCopiedToast"), { description: cmd });
    }
  }, [closeHistory, t]);

  const handleCopyResume = async (session: HistorySession) => {
    const cmd = await getResumeCommand(session.id);
    if (cmd) {
      await navigator.clipboard.writeText(cmd);
      toast.success(t("agentHistory.resumeCommandCopiedClipboard"), { description: cmd });
    } else {
      toast.error(t("agentHistory.noResumeAvailable"));
    }
  };

  const handleExportMarkdown = async (session: HistorySession) => {
    const md = await exportSessionMarkdown(session.id);
    if (md) {
      await navigator.clipboard.writeText(md);
      toast.success(t("agentHistory.transcriptCopiedToast"));
    }
  };

  const handleRunTextInTerminal = useCallback((text: string) => {
    const leafId = getActiveTerminalLeafId();
    if (leafId !== null) {
      submitToLeaf(leafId, text);
      toast.success(t("agentHistory.sentToTerminal"), { description: text.slice(0, 50) });
      closeHistory();
    } else {
      void navigator.clipboard.writeText(text);
      toast.success(t("agentHistory.copiedToClipboard"), { description: text.slice(0, 50) });
    }
  }, [closeHistory, t]);

  // Keyboard shortcuts (Ctrl+H toggle, Ctrl+F in transcript, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        useAgentHistoryStore.getState().toggleHistory();
        return;
      }

      if (!useAgentHistoryStore.getState().isOpen) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsFindOpen(true);
        setTimeout(() => findInputRef.current?.focus(), 50);
        return;
      }

      if (e.key === "Escape") {
        if (isFindOpen) {
          e.preventDefault();
          closeFind();
        } else {
          useAgentHistoryStore.getState().closeHistory();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFindOpen, closeFind]);

  useEffect(() => {
    if (isOpen) {
      setLocalSearch(useAgentHistoryStore.getState().searchQuery);
      const timer = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    } else {
      resetPosition();
      setIsMaximized(false);
      closeFind();
    }
  }, [isOpen, resetPosition, closeFind]);

  const toggleTool = (msgId: string) => {
    setExpandedTools((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-4 duration-150 animate-in fade-in-0"
      onClick={closeHistory}
    >
      <div
        className="relative flex flex-col rounded-xl border border-border/80 bg-card text-foreground shadow-2xl overflow-hidden select-none transition-shadow duration-150 animate-in zoom-in-95"
        style={{
          width: isMaximized ? "calc(100vw - 32px)" : `${size.width}px`,
          height: isMaximized ? "calc(100vh - 32px)" : `${size.height}px`,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100vh - 24px)",
          transform: isMaximized ? "none" : `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Draggable Header Bar */}
        <div
          {...dragHandleProps}
          onDoubleClick={toggleMaximize}
          className="h-11 shrink-0 px-4 border-b border-border/60 bg-muted/40 flex items-center justify-between space-y-0 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2.5 pointer-events-none min-w-0">
            <HugeiconsIcon
              icon={Clock01Icon}
              size={16}
              strokeWidth={2}
              className="text-primary shrink-0"
            />
            <span className="text-xs font-semibold tracking-tight text-foreground truncate">
              {t("agentHistory.title")}
            </span>
            {stats && (
              <Badge variant="outline" className="hidden sm:inline-flex text-[10px] text-muted-foreground font-mono shrink-0">
                {stats.total_sessions} {t("agentHistory.sessionsCount")} · {stats.total_messages} {t("agentHistory.messagesCount")}
              </Badge>
            )}
            {isScanning && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-primary animate-pulse font-medium">
                <span className="size-1.5 rounded-full bg-primary" />
                {t("agentHistory.scanningFiles")}
              </span>
            )}
          </div>

          <div
            className="flex items-center gap-1.5 shrink-0"
            data-no-drag
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Button
              type="button"
              data-no-drag
              size="sm"
              variant="outline"
              onClick={() => void rescan()}
              disabled={isScanning}
              className="h-6.5 gap-1.5 px-2.5 text-[11px] font-medium bg-background/80 hover:bg-muted cursor-pointer"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                size={12}
                className={cn(isScanning && "animate-spin text-primary")}
              />
              <span>{isScanning ? t("agentHistory.scanning") : t("agentHistory.rescan")}</span>
            </Button>

            {/* Maximize / Restore Button */}
            <Button
              type="button"
              data-no-drag
              size="icon"
              variant="ghost"
              onClick={toggleMaximize}
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
              title={isMaximized ? t("windowControls.restore") : t("windowControls.maximize")}
            >
              <HugeiconsIcon
                icon={isMaximized ? Copy01Icon : SquareIcon}
                size={12}
                strokeWidth={2}
              />
            </Button>

            {/* Close Button */}
            <Button
              type="button"
              data-no-drag
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                closeHistory();
              }}
              className="size-6 text-muted-foreground hover:text-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer rounded-md"
              title={t("agentHistory.closeEsc")}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
            </Button>
          </div>
        </div>

        {/* 2-Column Workspace */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          {/* Left Column: Session Browser & Filters (310px) */}
          <div className="flex w-78 min-w-78 max-w-78 shrink-0 flex-col border-r border-border/60 bg-muted/20 overflow-hidden">
            {/* Search Box */}
            <div className="relative border-b border-border/40 p-2 shrink-0">
              <HugeiconsIcon
                icon={Search01Icon}
                size={13}
                className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                value={localSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t("agentHistory.searchPlaceholder")}
                className="h-7.5 pl-7 pr-7 text-xs bg-background border-border/70 rounded-md focus-visible:ring-1 focus-visible:ring-primary/40"
              />
              {localSearch && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} />
                </button>
              )}
            </div>

            {/* Agent Filter Pills */}
            <div className="flex flex-wrap gap-1 border-b border-border/40 p-2 bg-muted/30 shrink-0">
              {["all", "gemini", "codex", "claude", "cursor", "voktty"].map((ag) => (
                <Button
                  key={ag}
                  size="xs"
                  variant={selectedAgent === ag ? "secondary" : "ghost"}
                  onClick={() => setSelectedAgent(ag)}
                  className={cn(
                    "h-5.5 px-2 text-[10.5px] capitalize font-medium cursor-pointer",
                    selectedAgent === ag && "shadow-xs border border-border/50 bg-background",
                  )}
                >
                  {ag === "all" ? t("agentHistory.allFilter") : ag}
                </Button>
              ))}
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
              {isLoading && sessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
                  <span>{t("agentHistory.searchingSessions")}</span>
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <HugeiconsIcon icon={Clock01Icon} size={24} className="opacity-30 mb-2" />
                  <span>{localSearch ? t("agentHistory.noMatchesFound") : t("agentHistory.noSessionsFound")}</span>
                  <span className="text-[10.5px] opacity-70 mt-1">
                    {localSearch ? t("agentHistory.tryDifferentSearch") : t("agentHistory.clickRescan")}
                  </span>
                  {localSearch && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={handleClearSearch}
                      className="mt-3 text-[11px] h-6"
                    >
                      {t("agentHistory.clearSearch")}
                    </Button>
                  )}
                </div>
              ) : (
                sessions.map((s) => {
                  const badge = AGENT_BADGES[s.agent] || {
                    bg: "bg-zinc-500/15",
                    color: "text-zinc-400",
                    i18nKey: s.agent,
                  };
                  const isActive = activeSessionId === s.id;

                  return (
                    <ContextMenu key={s.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => void selectSession(s.id)}
                          className={cn(
                            "group flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 transition-colors text-xs select-none",
                            isActive
                              ? "border-primary/60 bg-primary/10 shadow-xs"
                              : "border-transparent bg-background/60 hover:border-border/60 hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[9.5px] font-semibold font-mono",
                                badge.bg,
                                badge.color,
                              )}
                            >
                              {t(`agentHistory.agents.${badge.i18nKey}`) || s.agent}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {s.updated_at ? new Date(s.updated_at * 1000).toLocaleDateString() : ""}
                            </span>
                          </div>

                          <span className="line-clamp-2 font-medium leading-snug text-foreground break-words">
                            {s.title}
                          </span>

                          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground mt-0.5">
                            <span className="truncate max-w-[140px]">📁 {s.project_name}</span>
                            <span>{s.message_count} {t("agentHistory.msgs")}</span>
                          </div>
                        </div>
                      </ContextMenuTrigger>

                      <ContextMenuContent className="w-56 p-1 text-xs">
                        {s.can_resume && (
                          <ContextMenuItem
                            onClick={() => void handleResumeInTerminal(s)}
                            className="flex items-center gap-2 cursor-pointer font-medium text-primary"
                          >
                            <HugeiconsIcon icon={TerminalIcon} size={14} />
                            <span>{t("agentHistory.resumeInTerminal")}</span>
                          </ContextMenuItem>
                        )}

                        <ContextMenuItem
                          onClick={() => void handleCopyResume(s)}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <HugeiconsIcon icon={PlayIcon} size={14} />
                          <span>{t("agentHistory.copyResumeCommand")}</span>
                        </ContextMenuItem>

                        <ContextMenuItem
                          onClick={() => void handleExportMarkdown(s)}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <HugeiconsIcon icon={Download01Icon} size={14} />
                          <span>{t("agentHistory.copyTranscript")}</span>
                        </ContextMenuItem>

                        <ContextMenuSeparator className="my-1 border-border/40" />

                        <ContextMenuItem
                          onClick={() => void deleteSession(s.id)}
                          className="flex items-center gap-2 cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={14} />
                          <span>{t("agentHistory.deleteSession")}</span>
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Transcript View & Action Bar */}
          <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden bg-background">
            {activeSession ? (
              <>
                {/* Detail Action Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 shrink-0">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {activeSession.title}
                    </span>
                    <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground mt-0.5">
                      <span className="truncate max-w-sm">📁 {activeSession.project_path || activeSession.project_name}</span>
                      {activeSession.git_branch && (
                        <span>🌿 {activeSession.git_branch}</span>
                      )}
                      <span>💬 {activeSession.message_count} {t("agentHistory.messagesCount")}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* In-page Find Button */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsFindOpen(true);
                        setTimeout(() => findInputRef.current?.focus(), 50);
                      }}
                      className="h-6.5 gap-1 px-2 text-xs bg-background/80 hover:bg-muted cursor-pointer"
                      title={t("agentHistory.findInTranscript")}
                    >
                      <HugeiconsIcon icon={Search01Icon} size={12} />
                      <span>{t("agentHistory.find")}</span>
                      <kbd className="hidden sm:inline text-[9px] opacity-60 ml-0.5 font-mono">Ctrl+F</kbd>
                    </Button>

                    {activeSession.can_resume && (
                      <Button
                        size="sm"
                        onClick={() => void handleResumeInTerminal(activeSession)}
                        className="h-6.5 gap-1.5 px-2.5 text-xs font-semibold cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                        title={t("agentHistory.resumeTooltip")}
                      >
                        <HugeiconsIcon icon={TerminalIcon} size={12} />
                        <span>{t("agentHistory.resumeInTerminal")}</span>
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleExportMarkdown(activeSession)}
                      className="h-6.5 gap-1 px-2 text-xs bg-background/80 hover:bg-muted cursor-pointer"
                      title={t("agentHistory.copyTranscriptTooltip")}
                    >
                      <HugeiconsIcon icon={Download01Icon} size={12} />
                      <span>{t("agentHistory.export")}</span>
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void deleteSession(activeSession.id)}
                      className="size-6.5 text-muted-foreground hover:text-destructive cursor-pointer"
                      title={t("agentHistory.deleteSession")}
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={13} />
                    </Button>
                  </div>
                </div>

                {/* Floating Ctrl+F Search Bar in Transcript */}
                {isFindOpen && (
                  <div className="absolute top-11 right-4 z-40 flex items-center gap-1.5 rounded-lg border border-border/80 bg-popover/95 p-1.5 text-xs shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95">
                    <Input
                      ref={findInputRef}
                      value={findQuery}
                      onChange={(e) => handleFindChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (e.shiftKey) handleFindPrev();
                          else handleFindNext();
                        }
                      }}
                      placeholder={t("agentHistory.findPlaceholder")}
                      className="h-6.5 w-48 text-xs font-mono bg-background border-border/60"
                    />
                    <span className="text-[10px] text-muted-foreground font-mono px-1">
                      {findMatchInfo.total > 0
                        ? `${findMatchInfo.current}/${findMatchInfo.total}`
                        : findQuery
                          ? "0/0"
                          : ""}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleFindPrev}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                      title={t("agentHistory.previousMatch")}
                    >
                      <HugeiconsIcon icon={ArrowUp01Icon} size={12} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleFindNext}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                      title={t("agentHistory.nextMatch")}
                    >
                      <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={closeFind}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                      title={t("agentHistory.closeFind")}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={12} />
                    </Button>
                  </div>
                )}

                {/* Message Timeline with Context Menu */}
                <div
                  ref={transcriptRef}
                  className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-3 select-text"
                >
                  {isLoading ? (
                    <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                      <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
                      <span>{t("agentHistory.loadingTranscript")}</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                      <span>{t("agentHistory.noMessages")}</span>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isUser = msg.role === "user";
                      const isTool = msg.role === "tool";

                      return (
                        <ContextMenu key={msg.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              className={cn(
                                "flex flex-col gap-1.5 rounded-lg border p-3 text-xs leading-relaxed max-w-full overflow-hidden transition-colors",
                                isUser
                                  ? "border-primary/40 bg-primary/5 ml-4 hover:border-primary/60"
                                  : isTool
                                    ? "border-amber-500/30 bg-amber-500/5 mx-1"
                                    : "border-border/70 bg-card mr-4 hover:border-border",
                              )}
                            >
                              {/* Message Header */}
                              <div className="flex items-center justify-between text-[11px] font-semibold select-none">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "capitalize",
                                      isUser
                                        ? "text-primary"
                                        : isTool
                                          ? "text-amber-400"
                                          : "text-foreground font-medium",
                                    )}
                                  >
                                    {isUser ? t("agentHistory.roleUser") : isTool ? t("agentHistory.roleTool") : t("agentHistory.roleAssistant")}
                                  </span>

                                  {msg.redacted && (
                                    <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 font-mono">
                                      {t("agentHistory.secretsRedacted")}
                                    </Badge>
                                  )}
                                </div>

                                {msg.timestamp > 0 && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {new Date(msg.timestamp * 1000).toLocaleTimeString()}
                                  </span>
                                )}
                              </div>

                              {/* Message Content */}
                              {msg.content && (
                                <div className="whitespace-pre-wrap break-words overflow-hidden [word-break:break-word] font-sans text-foreground/90 leading-relaxed max-w-full select-text">
                                  {msg.content}
                                </div>
                              )}

                              {/* Tool Invocations Accordion */}
                              {msg.tool_name && (
                                <div className="mt-1 rounded border border-border/50 bg-muted/30 overflow-hidden max-w-full">
                                  <div
                                    onClick={() => toggleTool(msg.id)}
                                    className="flex cursor-pointer items-center justify-between px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                                  >
                                    <div className="flex items-center gap-1.5 truncate min-w-0">
                                      <HugeiconsIcon
                                        icon={expandedTools[msg.id] ? ArrowDown01Icon : ArrowRight01Icon}
                                        size={11}
                                      />
                                      <span className="truncate">{t("agentHistory.tool")} <strong>{msg.tool_name}</strong></span>
                                    </div>
                                    {msg.is_error && (
                                      <Badge variant="outline" className="text-[9px] text-rose-500 border-rose-500/30 font-mono shrink-0">
                                        {t("agentHistory.error")}
                                      </Badge>
                                    )}
                                  </div>

                                  {expandedTools[msg.id] && (
                                    <div className="border-t border-border/40 p-2 space-y-2 text-[10.5px] font-mono max-w-full overflow-hidden">
                                      {msg.tool_input && (
                                        <div className="max-w-full overflow-hidden">
                                          <div className="text-muted-foreground/60 mb-0.5">{t("agentHistory.input")}</div>
                                          <pre className="max-h-40 max-w-full overflow-auto rounded bg-background p-2 text-foreground border border-border/40 whitespace-pre-wrap break-all [word-break:break-word]">
                                            {msg.tool_input}
                                          </pre>
                                        </div>
                                      )}

                                      {msg.tool_output && (
                                        <div className="max-w-full overflow-hidden">
                                          <div className="text-muted-foreground/60 mb-0.5">{t("agentHistory.output")}</div>
                                          <pre className="max-h-48 max-w-full overflow-auto rounded bg-background p-2 text-foreground border border-border/40 whitespace-pre-wrap break-all [word-break:break-word]">
                                            {msg.tool_output}
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </ContextMenuTrigger>

                          <ContextMenuContent className="w-56 p-1 text-xs">
                            <ContextMenuItem
                              onClick={() => {
                                void navigator.clipboard.writeText(msg.content);
                                toast.success(t("agentHistory.messageContentCopied"));
                              }}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <HugeiconsIcon icon={Copy01Icon} size={14} />
                              <span>{t("agentHistory.copyMessageContent")}</span>
                            </ContextMenuItem>

                            <ContextMenuItem
                              onClick={() => handleRunTextInTerminal(msg.content)}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <HugeiconsIcon icon={TerminalIcon} size={14} />
                              <span>{t("agentHistory.runInTerminal")}</span>
                            </ContextMenuItem>

                            <ContextMenuSeparator className="my-1 border-border/40" />

                            <ContextMenuItem
                              onClick={() => {
                                setIsFindOpen(true);
                                const selected = window.getSelection()?.toString() || msg.content.slice(0, 30);
                                handleFindChange(selected);
                                setTimeout(() => findInputRef.current?.focus(), 50);
                              }}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <HugeiconsIcon icon={Search01Icon} size={14} />
                              <span>{t("agentHistory.findInTranscript")}</span>
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground/70">
                <HugeiconsIcon icon={Clock01Icon} size={32} strokeWidth={1.5} className="opacity-40 mb-2" />
                <span className="text-xs font-semibold text-foreground/80">{t("agentHistory.selectSessionPrompt")}</span>
                <span className="text-[11px] max-w-sm mt-1">
                  {t("agentHistory.emptyDescription", { shortcut: "Ctrl+Shift+H" })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Resizing Corner Handle with Pointer Capture */}
        {!isMaximized && (
          <div
            onPointerDown={handleResizePointerDown}
            className="absolute bottom-0 right-0 size-5 cursor-nwse-resize hover:bg-primary/30 z-50 flex items-end justify-end p-1 select-none"
            title={t("agentHistory.dragToResize")}
          >
            <div className="size-2.5 border-r-2 border-b-2 border-muted-foreground/60 rounded-br-xs pointer-events-none" />
          </div>
        )}
      </div>
    </div>
  );
}