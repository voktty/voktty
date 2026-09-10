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
  CpuIcon,
  Delete02Icon,
  Download01Icon,
  Folder01Icon,
  GitBranchIcon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  SquareIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { exportSessionMarkdown, getResumeCommand } from "../lib/agentHistoryBridge";
import { useTranslation } from "@/modules/i18n";
import { useAgentHistoryStore } from "../store/agentHistoryStore";
import type { HistorySession } from "../types";

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 740;
const MIN_WIDTH = 750;
const MIN_HEIGHT = 480;

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
  const agentBadges: Record<string, { bg: string; color: string; label: string }> = {
    claude: { bg: "bg-purple-500/15", color: "text-purple-400", label: t("agentHistory.agents.claude") },
    codex: { bg: "bg-emerald-500/15", color: "text-emerald-400", label: t("agentHistory.agents.codex") },
    cursor: { bg: "bg-sky-500/15", color: "text-sky-400", label: t("agentHistory.agents.cursor") },
    voktty: { bg: "bg-blue-500/15", color: "text-blue-400", label: t("agentHistory.agents.voktty") },
    gemini: { bg: "bg-amber-500/15", color: "text-amber-400", label: t("agentHistory.agents.gemini") },
    kimi: { bg: "bg-teal-500/15", color: "text-teal-400", label: t("agentHistory.agents.kimi") },
    opencode: { bg: "bg-indigo-500/15", color: "text-indigo-400", label: t("agentHistory.agents.opencode") },
    grok: { bg: "bg-rose-500/15", color: "text-rose-400", label: t("agentHistory.agents.grok") },
  };
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  // In-transcript Ctrl+F search state
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatchInfo, setFindMatchInfo] = useState<DomSearchMatchInfo>({ current: 0, total: 0 });

  const [size] = useState({
    width: typeof window !== "undefined" ? Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 60)) : DEFAULT_WIDTH,
    height: typeof window !== "undefined" ? Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 60)) : DEFAULT_HEIGHT,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const searchControllerRef = useRef<ReturnType<typeof createDomSearchController> | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { position, dragHandleProps, resetPosition, setPosition } = useDraggableModal({
    resetOnClose: true,
  });

  // Calculate agent & project counts
  const agentCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) {
      if (s.agent) map[s.agent] = (map[s.agent] || 0) + 1;
    }
    return map;
  }, [sessions]);

  const projectCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) {
      if (s.project_name) map[s.project_name] = (map[s.project_name] || 0) + 1;
    }
    return map;
  }, [sessions]);

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (selectedAgent !== "all" && s.agent !== selectedAgent) return false;
      if (selectedProject && s.project_name !== selectedProject) return false;
      return true;
    });
  }, [sessions, selectedAgent, selectedProject]);

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

  // Global keydown handler for Escape, Ctrl+F, Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        if (isFindOpen) {
          e.preventDefault();
          closeFind();
        } else {
          closeHistory();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsFindOpen(true);
        setTimeout(() => findInputRef.current?.focus(), 50);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isFindOpen, closeFind, closeHistory]);

  const toggleMaximize = () => {
    if (isMaximized) {
      setIsMaximized(false);
      resetPosition();
    } else {
      setIsMaximized(true);
      setPosition({ x: 0, y: 0 });
    }
  };

  const handleCopyText = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(t("agentHistory.textCopied"));
  };

  const handleExportMarkdown = async (s: HistorySession) => {
    const md = await exportSessionMarkdown(s.id);
    void navigator.clipboard.writeText(md);
    toast.success(t("agentHistory.transcriptCopied"));
  };

  const handleResumeInTerminal = async (s: HistorySession) => {
    const cmd = await getResumeCommand(s.id);
    if (!cmd) {
      toast.error(t("agentHistory.cannotResume"));
      return;
    }
    const leafId = getActiveTerminalLeafId();
    if (leafId === null) {
      toast.error(t("agentHistory.noActiveTerminal"));
      return;
    }

    submitToLeaf(leafId, `${cmd}\r`);
    toast.success(t("agentHistory.resumingSession", { agent: s.agent }));
    closeHistory();
  };

  const handleCopyResume = async (s: HistorySession) => {
    const cmd = await getResumeCommand(s.id);
    if (cmd) {
      void navigator.clipboard.writeText(cmd);
      toast.success(t("agentHistory.resumeCommandCopied"));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150">
      <div
        style={{
          width: isMaximized ? "100vw" : `${size.width}px`,
          height: isMaximized ? "100vh" : `${size.height}px`,
          transform: isMaximized
            ? "none"
            : position.x || position.y
              ? `translate3d(${position.x}px, ${position.y}px, 0)`
              : undefined,
        }}
        className={cn(
          "relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl transition-all duration-100",
          isMaximized && "rounded-none border-none",
        )}
      >
        {/* Header Bar */}
        <div
          {...dragHandleProps}
          className="flex h-11 items-center justify-between border-b border-border/60 bg-muted/40 px-3.5 select-none shrink-0"
        >
          <div className="flex items-center gap-2 font-medium text-xs text-foreground">
            <HugeiconsIcon icon={CpuIcon} size={15} className="text-primary" />
            <span>{t("agentHistory.modalTitle")}</span>
            {stats && (
              <span className="text-[11px] text-muted-foreground ml-1">
                ({t("agentHistory.sessionStats", {
                  sessions: stats.total_sessions,
                  messages: stats.total_messages,
                })})
              </span>
            )}
          </div>

          <div
            className="flex items-center gap-1.5"
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

        {/* 3-Column Wake-Style Workspace */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          {/* Column 1: Left Navigation Sidebar (w-52) */}
          <div className="flex w-52 min-w-52 max-w-52 shrink-0 flex-col border-r border-border/60 bg-muted/20 overflow-y-auto p-2 space-y-4">
            {/* Search Box */}
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                size={13}
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                value={localSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t("agentHistory.searchShortcutPlaceholder")}
                className="h-7 pl-7 pr-6 text-xs bg-background border-border/70 rounded-md focus-visible:ring-1 focus-visible:ring-primary/40"
              />
              {localSearch && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={11} />
                </button>
              )}
            </div>

            {/* Main Views */}
            <div className="space-y-0.5">
              <Button
                size="sm"
                variant={selectedAgent === "all" && !selectedProject ? "secondary" : "ghost"}
                onClick={() => {
                  setSelectedAgent("all");
                  setSelectedProject(null);
                }}
                className={cn(
                  "w-full justify-between h-7 px-2 text-xs font-medium cursor-pointer",
                  selectedAgent === "all" && !selectedProject && "bg-accent text-accent-foreground font-semibold",
                )}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={Clock01Icon} size={13} />
                  <span>{t("agentHistory.allSessions")}</span>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">{sessions.length}</span>
              </Button>
            </div>

            {/* Agents List Section */}
            <div className="space-y-1">
              <span className="px-2 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">
                {t("agentHistory.agentsLabel")}
              </span>
              <div className="space-y-0.5 mt-1">
                {Object.entries(agentBadges).map(([key, badge]) => {
                  const count = agentCounts[key] || 0;
                  if (count === 0 && key !== "claude" && key !== "codex") return null;
                  const isSelected = selectedAgent === key && !selectedProject;

                  return (
                    <Button
                      key={key}
                      size="sm"
                      variant={isSelected ? "secondary" : "ghost"}
                      onClick={() => {
                        setSelectedAgent(key);
                        setSelectedProject(null);
                      }}
                      className={cn(
                        "w-full justify-between h-6.5 px-2 text-xs cursor-pointer",
                        isSelected && "bg-accent text-accent-foreground font-semibold",
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={cn("size-2 rounded-full", badge.bg.replace('/15', ''))} />
                        <span className="truncate">{badge.label}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">{count}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Projects List Section */}
            {Object.keys(projectCounts).length > 0 && (
              <div className="space-y-1">
                <span className="px-2 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("agentHistory.projectsLabel")}
                </span>
                <div className="space-y-0.5 mt-1 max-h-48 overflow-y-auto">
                  {Object.entries(projectCounts).map(([proj, count]) => {
                    const isSelected = selectedProject === proj;

                    return (
                      <Button
                        key={proj}
                        size="sm"
                        variant={isSelected ? "secondary" : "ghost"}
                        onClick={() => {
                          setSelectedProject(proj);
                        }}
                        className={cn(
                          "w-full justify-between h-6.5 px-2 text-xs cursor-pointer",
                          isSelected && "bg-accent text-accent-foreground font-semibold",
                        )}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <HugeiconsIcon icon={Folder01Icon} size={12} className="text-muted-foreground shrink-0" />
                          <span className="truncate">{proj}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">{count}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Column 2: Middle Sessions List (w-72) */}
          <div className="flex w-72 min-w-72 max-w-72 shrink-0 flex-col border-r border-border/60 bg-background overflow-hidden">
            {/* Filter Header Bar */}
            <div className="flex items-center justify-between border-b border-border/40 px-3 py-2 shrink-0 bg-muted/10">
              <span className="text-xs font-semibold text-foreground truncate">
                {selectedProject
                  ? selectedProject
                  : selectedAgent !== "all"
                    ? agentBadges[selectedAgent]?.label || selectedAgent
                    : t("agentHistory.allSessions")}
              </span>
              <span className="text-[10.5px] text-muted-foreground font-mono">
                {filteredSessions.length} {t("agentHistory.sessionsCount")}
              </span>
            </div>

            {/* Sessions Cards Container */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
              {isLoading && filteredSessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
                  <span>{t("agentHistory.searchingSessions")}</span>
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <HugeiconsIcon icon={Clock01Icon} size={24} className="opacity-30 mb-2" />
                  <span>{localSearch ? t("agentHistory.noMatchesFound") : t("agentHistory.noSessionsFound")}</span>
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
                filteredSessions.map((s) => {
                  const badge = agentBadges[s.agent] || {
                    bg: "bg-zinc-500/15",
                    color: "text-zinc-400",
                    label: s.agent,
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
                              {badge.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {s.updated_at ? new Date(s.updated_at * 1000).toLocaleDateString() : ""}
                            </span>
                          </div>

                          <span className="line-clamp-2 font-medium leading-snug text-foreground break-words">
                            {s.title}
                          </span>

                          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground mt-0.5">
                            <span className="truncate max-w-[130px]">{s.project_name}</span>
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

          {/* Column 3: Right Transcript View & Actions (flex-1) */}
          <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden bg-background">
            {activeSession ? (
              <>
                {/* Detail Action Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 shrink-0">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {activeSession.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground mt-0.5">
                      <span className="truncate max-w-sm">📁 {activeSession.project_path || activeSession.project_name}</span>
                      {activeSession.git_branch && (
                        <span className="flex items-center gap-1">
                          <HugeiconsIcon icon={GitBranchIcon} size={11} />
                          {activeSession.git_branch}
                        </span>
                      )}
                      <span>{activeSession.message_count} {t("agentHistory.messagesCount")}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
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

                {/* Floating Ctrl+F Search Bar */}
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
                    >
                      <HugeiconsIcon icon={ArrowUp01Icon} size={12} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleFindNext}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={closeFind}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={12} />
                    </Button>
                  </div>
                )}

                {/* Message Timeline */}
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

                              <div className="whitespace-pre-wrap font-sans break-words overflow-x-auto selection:bg-primary/20">
                                {msg.content}
                              </div>

                              {msg.tool_name && (
                                <div className="mt-1 rounded border border-border/50 bg-muted/40 p-2 font-mono text-[11px]">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedTools((prev) => ({
                                        ...prev,
                                        [msg.id]: !prev[msg.id],
                                      }))
                                    }
                                    className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                                  >
                                    <HugeiconsIcon
                                      icon={expandedTools[msg.id] ? ArrowDown01Icon : ArrowRight01Icon}
                                      size={12}
                                    />
                                    <span>{t("agentHistory.tool")} {msg.tool_name}</span>
                                  </button>

                                  {expandedTools[msg.id] && (
                                    <div className="mt-2 space-y-1.5 overflow-x-auto text-[10.5px]">
                                      {msg.tool_input && (
                                        <div>
                                          <div className="text-muted-foreground">{t("agentHistory.input")}</div>
                                          <pre className="p-1.5 rounded bg-background border border-border/40 whitespace-pre-wrap">
                                            {msg.tool_input}
                                          </pre>
                                        </div>
                                      )}

                                      {msg.tool_output && (
                                        <div>
                                          <div className="text-muted-foreground">{t("agentHistory.output")}</div>
                                          <pre className="p-1.5 rounded bg-background border border-border/40 whitespace-pre-wrap">
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

                          <ContextMenuContent className="w-48 p-1 text-xs">
                            <ContextMenuItem
                              onClick={() => handleCopyText(msg.content)}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <HugeiconsIcon icon={Copy01Icon} size={14} />
                              <span>{t("agentHistory.copyMessageText")}</span>
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground">
                <HugeiconsIcon icon={Clock01Icon} size={32} className="opacity-20 mb-3" />
                <span className="font-medium text-foreground">{t("agentHistory.noSessionSelected")}</span>
                <span className="mt-1 text-[11px] opacity-70">
                  {t("agentHistory.selectSessionDetail")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
