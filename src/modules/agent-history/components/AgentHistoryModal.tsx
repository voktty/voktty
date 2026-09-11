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
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  Folder01Icon,
  GitBranchIcon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  SquareIcon,
  StarIcon,
  TerminalIcon,
  Layers01Icon,
  SortByDown01Icon,
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
const MIN_WIDTH = 800;
const MIN_HEIGHT = 520;

const AGENT_BRANDS: Record<string, { name: string; icon: string; bg: string; color: string }> = {
  "claude-code": { name: "Claude Code", icon: "/brands/claude-code.png", bg: "bg-amber-500/15", color: "text-amber-500" },
  claude: { name: "Claude Code", icon: "/brands/claude-code.png", bg: "bg-amber-500/15", color: "text-amber-500" },
  codex: { name: "Codex", icon: "/brands/codex.png", bg: "bg-emerald-500/15", color: "text-emerald-400" },
  grok: { name: "Grok", icon: "/brands/grok.png", bg: "bg-rose-500/15", color: "text-rose-400" },
  dsh: { name: "DeepSeek", icon: "/brands/deepseek.png", bg: "bg-blue-600/15", color: "text-blue-400" },
  cursor: { name: "Cursor", icon: "/brands/cursor.png", bg: "bg-sky-500/15", color: "text-sky-400" },
  opencode: { name: "OpenCode", icon: "/brands/opencode.png", bg: "bg-indigo-500/15", color: "text-indigo-400" },
  pi: { name: "Pi", icon: "/brands/pi.png", bg: "bg-amber-600/15", color: "text-amber-400" },
  omp: { name: "Omp", icon: "/brands/omp.png", bg: "bg-teal-600/15", color: "text-teal-400" },
  kiro: { name: "Kiro", icon: "/brands/kiro.png", bg: "bg-purple-500/15", color: "text-purple-400" },
  kimi: { name: "Kimi", icon: "/brands/kimi.png", bg: "bg-teal-500/15", color: "text-teal-400" },
  gemini: { name: "Gemini CLI", icon: "/brands/gemini.png", bg: "bg-amber-500/15", color: "text-amber-400" },
  copilot: { name: "Copilot CLI", icon: "/brands/copilot.png", bg: "bg-cyan-500/15", color: "text-cyan-400" },
  antigravity: { name: "Antigravity", icon: "/brands/antigravity.png", bg: "bg-fuchsia-500/15", color: "text-fuchsia-400" },
  qoder: { name: "Qoder", icon: "/brands/qoder.png", bg: "bg-lime-500/15", color: "text-lime-400" },
  hermes: { name: "Hermes", icon: "/brands/hermes.png", bg: "bg-orange-500/15", color: "text-orange-400" },
  openclaw: { name: "OpenClaw", icon: "/brands/openclaw.png", bg: "bg-red-500/15", color: "text-red-400" },
  voktty: { name: "Voktty", icon: "/voktty-icon.png", bg: "bg-blue-500/15", color: "text-blue-400" },
};

function formatRelativeTime(timestampSeconds: number): string {
  if (!timestampSeconds) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - timestampSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AgentHistoryModal() {
  const {
    isOpen,
    closeHistory,
    sessions,
    activeSessionId,
    activeSession,
    messages,
    isLoading,
    isMessagesLoading,
    isScanning,
    hasMore,
    loadMoreSessions,
    searchQuery,
    setSearchQuery,
    selectedAgent,
    setSelectedAgent,
    setSelectedProject: setStoreSelectedProject,
    selectSession,
    rescan,
    deleteSession,
  } = useAgentHistoryStore();

  const { t } = useTranslation();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [isStarredView, setIsStarredView] = useState(false);
  const [isAgentsOpen, setIsAgentsOpen] = useState(true);
  const [isProjectsOpen, setIsProjectsOpen] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0);

  // In-transcript Ctrl+F search state
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatchInfo, setFindMatchInfo] = useState<DomSearchMatchInfo>({ current: 0, total: 0 });

  const [size] = useState({
    width: typeof window !== "undefined" ? Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 60)) : DEFAULT_WIDTH,
    height: typeof window !== "undefined" ? Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 60)) : DEFAULT_HEIGHT,
  });

  const paletteInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const searchControllerRef = useRef<ReturnType<typeof createDomSearchController> | null>(null);

  const { position, dragHandleProps, resetPosition, setPosition } = useDraggableModal({
    resetOnClose: true,
  });

  const isAgentMatch = (sessionAgent: string, targetAgent: string) => {
    if (targetAgent === "all") return true;
    const sNorm = sessionAgent.toLowerCase();
    const tNorm = targetAgent.toLowerCase();
    if (sNorm === tNorm) return true;
    if ((tNorm === "claude" || tNorm === "claude-code") && (sNorm === "claude" || sNorm === "claude-code")) return true;
    return false;
  };

  // Calculate agent & project counts
  const agentCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) {
      if (s.agent) {
        const agKey = s.agent.toLowerCase() === "claude-code" ? "claude" : s.agent.toLowerCase();
        map[agKey] = (map[agKey] || 0) + 1;
      }
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
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = s.title.toLowerCase().includes(q);
        const matchProj = s.project_name.toLowerCase().includes(q);
        if (!matchTitle && !matchProj) return false;
      }
      if (selectedAgent !== "all" && !isAgentMatch(s.agent, selectedAgent)) return false;
      if (selectedProject && s.project_name !== selectedProject) return false;
      return true;
    });
  }, [sessions, selectedAgent, selectedProject, searchQuery]);

  // Debounced active session sync when filtered list changes
  useEffect(() => {
    if (filteredSessions.length > 0) {
      const exists = filteredSessions.some((s) => s.id === activeSessionId);
      if (!exists) {
        const timer = setTimeout(() => {
          void selectSession(filteredSessions[0].id);
        }, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [filteredSessions, activeSessionId, selectSession]);

  // Palette filtered sessions
  const paletteResults = useMemo(() => {
    if (!paletteQuery.trim()) return sessions.slice(0, 10);
    const q = paletteQuery.toLowerCase();
    return sessions
      .filter((s) => s.title.toLowerCase().includes(q) || s.project_name.toLowerCase().includes(q) || s.agent.toLowerCase().includes(q))
      .slice(0, 15);
  }, [sessions, paletteQuery]);

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
        if (isPaletteOpen) {
          e.preventDefault();
          setIsPaletteOpen(false);
        } else if (isFindOpen) {
          e.preventDefault();
          closeFind();
        } else {
          closeHistory();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsPaletteOpen(true);
        setTimeout(() => paletteInputRef.current?.focus(), 50);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsFindOpen(true);
        setTimeout(() => findInputRef.current?.focus(), 50);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isPaletteOpen, isFindOpen, closeFind, closeHistory]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150 font-sans">
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
          "relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-[#161618] text-[#ececed] shadow-2xl transition-all duration-100",
          isMaximized && "rounded-none border-none",
        )}
      >
        {/* Top App / Traffic Header */}
        <div
          {...dragHandleProps}
          className="flex h-10 items-center justify-between border-b border-border/40 bg-[#121214]/80 px-3.5 select-none shrink-0"
        >
          {/* Brand & Traffic Dots */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 mr-2">
              <span className="size-3 rounded-full bg-rose-500/80 inline-block hover:opacity-80 cursor-pointer" onClick={closeHistory} />
              <span className="size-3 rounded-full bg-amber-500/80 inline-block hover:opacity-80 cursor-pointer" onClick={() => resetPosition()} />
              <span className="size-3 rounded-full bg-emerald-500/80 inline-block hover:opacity-80 cursor-pointer" onClick={toggleMaximize} />
            </div>
            <span className="text-xs font-semibold tracking-wide text-foreground flex items-center gap-1.5">
              <span className="font-bold text-[13px]">{t("agentHistory.productName")}</span>
              <span className="text-[10.5px] text-muted-foreground/70 font-normal">{t("agentHistory.productVersion")}</span>
            </span>
          </div>

          {/* Window Controls Right */}
          <div
            className="flex items-center gap-1"
            data-no-drag
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Button
              type="button"
              data-no-drag
              size="icon"
              variant="ghost"
              onClick={toggleMaximize}
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
            >
              <HugeiconsIcon icon={isMaximized ? Copy01Icon : SquareIcon} size={12} />
            </Button>
            <Button
              type="button"
              data-no-drag
              size="icon"
              variant="ghost"
              onClick={closeHistory}
              className="size-6 text-muted-foreground hover:text-destructive cursor-pointer rounded-md"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} />
            </Button>
          </div>
        </div>

        {/* 3-Column Native Wake Layout */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {/* Column 1: Left Navigation Pane (w-56) */}
          <div className="flex w-56 min-w-56 max-w-56 shrink-0 flex-col border-r border-border/50 bg-[#141416] p-2.5 space-y-3 overflow-y-auto select-none">
            {/* Search Pill */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsPaletteOpen(true);
                  setTimeout(() => paletteInputRef.current?.focus(), 50);
                }}
                className="flex flex-1 items-center justify-between rounded-lg border border-border/60 bg-[#1c1c1f] px-2.5 py-1.5 text-xs text-muted-foreground hover:border-border hover:text-foreground cursor-pointer transition-colors shadow-xs"
              >
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={Search01Icon} size={13} />
                  <span>{t("agentHistory.searchSessions")}</span>
                </div>
                <kbd className="rounded bg-muted/60 px-1 py-0.2 text-[10px] font-mono text-muted-foreground/80">{t("agentHistory.searchShortcut")}</kbd>
              </button>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => void rescan()}
                disabled={isScanning}
                className="size-7 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg shrink-0"
                title={t("agentHistory.rescan")}
              >
                <HugeiconsIcon icon={RefreshIcon} size={13} className={cn(isScanning && "animate-spin text-primary")} />
              </Button>
            </div>

            {/* Main Views: All Sessions & Starred */}
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedAgent("all");
                  setSelectedProject(null);
                  setStoreSelectedProject("");
                  setIsStarredView(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  selectedAgent === "all" && !selectedProject && !isStarredView
                    ? "bg-[#252529] text-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-[#1c1c1f] hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={Layers01Icon} size={14} className="text-primary/90" />
                  <span>{t("agentHistory.allSessions")}</span>
                </div>
                <span className="text-[10.5px] font-mono opacity-60">{sessions.length}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsStarredView(true);
                  setSelectedProject(null);
                  setStoreSelectedProject("");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  isStarredView
                    ? "bg-[#252529] text-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-[#1c1c1f] hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={StarIcon} size={14} className="text-amber-400" />
                  <span>{t("agentHistory.starred")}</span>
                </div>
                <span className="text-[10.5px] font-mono opacity-60">0</span>
              </button>
            </div>

            {/* Agents Collapsible Section */}
            <div className="space-y-1 pt-1">
              <button
                type="button"
                onClick={() => setIsAgentsOpen(!isAgentsOpen)}
                className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <span>{t("agentHistory.agentsLabel")}</span>
                <HugeiconsIcon icon={isAgentsOpen ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
              </button>

              {isAgentsOpen && (
                <div className="space-y-0.5">
                  {Object.entries(AGENT_BRANDS).map(([key, brand]) => {
                    const count = agentCounts[key] || 0;
                    if (count === 0 && key !== "claude" && key !== "codex" && key !== "cursor" && key !== "gemini") return null;
                    const isSelected = (selectedAgent === key || (selectedAgent === "claude" && key === "claude-code")) && !selectedProject && !isStarredView;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedAgent(key);
                          setSelectedProject(null);
                          setStoreSelectedProject("");
                          setIsStarredView(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#252529] text-foreground font-semibold shadow-xs"
                            : "text-muted-foreground hover:bg-[#1c1c1f] hover:text-foreground",
                        )}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <img src={brand.icon} alt={brand.name} className="size-4 rounded object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          <span className="truncate">{brand.name}</span>
                        </div>
                        <span className="text-[10px] font-mono opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Projects Collapsible Section */}
            {Object.keys(projectCounts).length > 0 && (
              <div className="space-y-1 pt-1">
                <button
                  type="button"
                  onClick={() => setIsProjectsOpen(!isProjectsOpen)}
                  className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <span>{t("agentHistory.projectsLabel")}</span>
                  <HugeiconsIcon icon={isProjectsOpen ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
                </button>

                {isProjectsOpen && (
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {Object.entries(projectCounts).map(([proj, count]) => {
                      const isSelected = selectedProject === proj && !isStarredView;

                      return (
                        <button
                          key={proj}
                          type="button"
                          onClick={() => {
                            setSelectedProject(proj);
                            setStoreSelectedProject(proj);
                            setIsStarredView(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer",
                            isSelected
                              ? "bg-[#252529] text-foreground font-semibold shadow-xs"
                              : "text-muted-foreground hover:bg-[#1c1c1f] hover:text-foreground",
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <HugeiconsIcon icon={Folder01Icon} size={13} className="text-muted-foreground shrink-0" />
                            <span className="truncate">{proj}</span>
                          </div>
                          <span className="text-[10px] font-mono opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Column 2: Middle Sessions Stream (w-80) */}
          <div className="flex w-80 min-w-80 max-w-80 shrink-0 flex-col border-r border-border/50 bg-[#161618] overflow-hidden">
            {/* Stream Header */}
            <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2.5 shrink-0 bg-[#141416]/50">
              <span className="text-xs font-bold text-foreground truncate">
                {selectedProject
                  ? selectedProject
                  : isStarredView
                    ? t("agentHistory.starredSessions")
                    : selectedAgent !== "all"
                      ? AGENT_BRANDS[selectedAgent]?.name || selectedAgent
                      : t("agentHistory.allSessions")}
              </span>
              <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <HugeiconsIcon icon={SortByDown01Icon} size={12} />
                <span>{t("agentHistory.dateUpdated")}</span>
              </div>
            </div>

            {/* In-stream Instant Filter Bar */}
            <div className="border-b border-border/40 px-2.5 py-1.5 shrink-0 bg-[#131315]">
              <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-[#1a1a1d] px-2 py-1 text-xs focus-within:border-primary/60 transition-colors">
                <HugeiconsIcon icon={Search01Icon} size={12} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("agentHistory.searchSessionsCount", { count: sessions.length })}
                  className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
              {isLoading && sessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
                  <span>{t("agentHistory.loadingSessions")}</span>
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <HugeiconsIcon icon={Layers01Icon} size={24} className="opacity-20 mb-2" />
                  <span>{t("agentHistory.noSessionsFound")}</span>
                </div>
              ) : (
                <>
                {filteredSessions.map((s) => {
                  const brand = AGENT_BRANDS[s.agent] || AGENT_BRANDS["claude"];
                  const isActive = activeSessionId === s.id;

                  return (
                    <ContextMenu key={s.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => void selectSession(s.id)}
                          className={cn(
                            "group flex cursor-pointer flex-col gap-1 rounded-xl border p-2.5 transition-all text-xs select-none",
                            isActive
                              ? "border-border/90 bg-[#222226] shadow-sm"
                              : "border-transparent bg-[#1a1a1d]/60 hover:border-border/50 hover:bg-[#1f1f23]",
                          )}
                        >
                          <span className="line-clamp-2 font-medium leading-snug text-[#f2f2f3] break-words">
                            {s.title}
                          </span>

                          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground/80 mt-1">
                            <div className="flex items-center gap-1.5 truncate max-w-[190px]">
                              <img src={brand.icon} alt={brand.name} className="size-3.5 rounded object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                              <span className="truncate">{s.project_name}</span>
                            </div>
                            <span className="font-mono text-[10px] shrink-0">
                              {formatRelativeTime(s.updated_at)}
                            </span>
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
                })}
                {hasMore && !searchQuery && selectedAgent === "all" && !selectedProject && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadMoreSessions()}
                    disabled={isLoading}
                    aria-label={t("agentHistory.loadingSessions")}
                    className="w-full text-muted-foreground"
                  >
                    <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
                  </Button>
                )}
                </>
              )}
            </div>
          </div>

          {/* Column 3: Right Transcript Reader Pane (flex-1) */}
          <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden bg-[#18181b]">
            {activeSession ? (
              <>
                {/* Session Top Header Bar */}
                <div className="flex flex-col gap-2 border-b border-border/40 bg-[#161619] px-5 py-3 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    {/* Breadcrumb Tags */}
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <img src={AGENT_BRANDS[activeSession.agent]?.icon || "/brands/claude-code.png"} alt={t("agentHistory.agent")} className="size-4 rounded object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        <span>{AGENT_BRANDS[activeSession.agent]?.name || activeSession.agent}</span>
                      </div>
                      <span className="text-muted-foreground/50">/</span>
                      <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {activeSession.project_name}
                      </span>
                      {activeSession.git_branch && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                          <HugeiconsIcon icon={GitBranchIcon} size={11} />
                          {activeSession.git_branch}
                        </span>
                      )}
                    </div>

                    {/* Action Icon Buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      {activeSession.can_resume && (
                        <Button
                          size="sm"
                          onClick={() => void handleResumeInTerminal(activeSession)}
                          className="h-7 gap-1.5 px-2.5 text-xs font-semibold cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg shadow-xs"
                          title={t("agentHistory.resumeInTerminal")}
                        >
                          <HugeiconsIcon icon={TerminalIcon} size={13} />
                          <span>{t("agentHistory.resume")}</span>
                        </Button>
                      )}

                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => void handleExportMarkdown(activeSession)}
                        className="size-7 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
                        title={t("agentHistory.copyTranscriptMarkdown")}
                      >
                        <HugeiconsIcon icon={Copy01Icon} size={14} />
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => void deleteSession(activeSession.id)}
                        className="size-7 text-muted-foreground hover:text-destructive cursor-pointer rounded-lg"
                        title={t("agentHistory.deleteSession")}
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={14} />
                      </Button>
                    </div>
                  </div>

                  {/* Title & Path */}
                  <div>
                    <h2 className="text-base font-bold text-foreground leading-snug">
                      {activeSession.title}
                    </h2>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5 opacity-70 truncate">
                      📁 {activeSession.project_path || activeSession.file_path}
                    </div>
                  </div>
                </div>

                {/* Floating Ctrl+F Search Bar */}
                {isFindOpen && (
                  <div className="absolute top-12 right-6 z-40 flex items-center gap-1.5 rounded-xl border border-border/80 bg-[#1c1c20]/95 p-1.5 text-xs shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95">
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
                      className="h-7 w-48 text-xs font-mono bg-background/80 border-border/60"
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
                  className="flex-1 min-w-0 min-h-0 overflow-y-auto p-5 space-y-4 select-text"
                >
                  {isMessagesLoading && messages.length === 0 ? (
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
                        <div
                          key={msg.id}
                          className={cn(
                            "flex flex-col gap-2 rounded-xl p-3.5 text-xs leading-relaxed max-w-3xl transition-colors border",
                            isUser
                              ? "border-[#3b3b44] bg-[#222227] ml-auto mr-2 text-foreground shadow-xs"
                              : isTool
                                ? "border-amber-500/20 bg-amber-500/5 mx-2"
                                : "border-[#2b2b32] bg-[#1a1a1e] mr-auto ml-2 text-[#ececed]",
                          )}
                        >
                          {/* Role Header */}
                          <div className="flex items-center justify-between text-[11px] select-none font-semibold pb-1 border-b border-border/30">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "font-medium",
                                  isUser ? "text-primary font-semibold" : isTool ? "text-amber-400" : "text-purple-400 font-semibold",
                                )}
                              >
                                {isUser ? t("agentHistory.user") : isTool ? t("agentHistory.toolExecution") : t("agentHistory.assistant")}
                              </span>
                              {msg.redacted && (
                                <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 font-mono">
                                  {t("agentHistory.redacted")}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {msg.timestamp > 0 && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {new Date(msg.timestamp * 1000).toLocaleTimeString()}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleCopyText(msg.content)}
                                className="text-muted-foreground hover:text-foreground cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                                title={t("agentHistory.copyMessageText")}
                              >
                                <HugeiconsIcon icon={Copy01Icon} size={12} />
                              </button>
                            </div>
                          </div>

                          {/* Thinking Process Accordion */}
                          {msg.thinking && (
                            <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-2 font-mono text-[11px] my-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedThinking((prev) => ({
                                    ...prev,
                                    [msg.id]: !prev[msg.id],
                                  }))
                                }
                                className="flex items-center gap-1.5 font-semibold text-purple-400 hover:text-purple-300 cursor-pointer"
                              >
                                <HugeiconsIcon
                                  icon={expandedThinking[msg.id] ? ArrowDown01Icon : ArrowRight01Icon}
                                  size={12}
                                />
                                <span>{t("agentHistory.thinkingProcess")}</span>
                              </button>
                              {expandedThinking[msg.id] && (
                                <pre className="mt-2 p-2 rounded bg-background/80 border border-purple-500/20 whitespace-pre-wrap text-[10.5px] text-muted-foreground font-mono overflow-x-auto max-h-80">
                                  {msg.thinking}
                                </pre>
                              )}
                            </div>
                          )}

                          {/* Message Content */}
                          {msg.content && (
                            <div className="whitespace-pre-wrap font-sans break-words overflow-x-auto selection:bg-primary/20">
                              {msg.content}
                            </div>
                          )}

                          {/* Tool Invocations */}
                          {msg.tool_name && (
                            <div className="mt-1 rounded-lg border border-border/60 bg-[#121214] p-2 font-mono text-[11px]">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedTools((prev) => ({
                                    ...prev,
                                    [msg.id]: !prev[msg.id],
                                  }))
                                }
                                className="flex items-center gap-1.5 font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                              >
                                <HugeiconsIcon
                                  icon={expandedTools[msg.id] ? ArrowDown01Icon : ArrowRight01Icon}
                                  size={12}
                                />
                                <span>{t("agentHistory.tool")} {msg.tool_name}</span>
                              </button>

                              {expandedTools[msg.id] && (
                                <div className="mt-2 space-y-2 overflow-x-auto text-[10.5px]">
                                  {msg.tool_input && (
                                    <div>
                                      <div className="text-muted-foreground text-[10px] uppercase font-semibold">{t("agentHistory.input")}</div>
                                      <pre className="p-2 rounded bg-[#18181b] border border-border/40 whitespace-pre-wrap">
                                        {msg.tool_input}
                                      </pre>
                                    </div>
                                  )}
                                  {msg.tool_output && (
                                    <div>
                                      <div className="text-muted-foreground text-[10px] uppercase font-semibold">{t("agentHistory.output")}</div>
                                      <pre className="p-2 rounded bg-[#18181b] border border-border/40 whitespace-pre-wrap max-h-60 overflow-y-auto">
                                        {msg.tool_output}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground">
                <HugeiconsIcon icon={Layers01Icon} size={36} className="opacity-20 mb-3" />
                <span className="font-semibold text-foreground text-sm">{t("agentHistory.noSessionSelected")}</span>
                <span className="mt-1 text-[11px] opacity-70">
                  {t("agentHistory.selectSessionTranscript")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ⌘K Fast Search Palette Overlay */}
        {isPaletteOpen && (
          <div
            className="fixed inset-0 z-60 flex items-start justify-center pt-24 bg-black/50 backdrop-blur-xs animate-in fade-in-0 duration-100"
            onClick={() => setIsPaletteOpen(false)}
          >
            <div
              className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-[#18181b] shadow-2xl animate-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Search Bar */}
              <div className="flex items-center border-b border-border/60 px-3.5 py-3">
                <HugeiconsIcon icon={Search01Icon} size={16} className="text-muted-foreground mr-2.5" />
                <input
                  ref={paletteInputRef}
                  value={paletteQuery}
                  onChange={(e) => {
                    setPaletteQuery(e.target.value);
                    setPaletteSelectedIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setPaletteSelectedIndex((prev) => Math.min(paletteResults.length - 1, prev + 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setPaletteSelectedIndex((prev) => Math.max(0, prev - 1));
                    } else if (e.key === "Enter" && paletteResults[paletteSelectedIndex]) {
                      e.preventDefault();
                      void selectSession(paletteResults[paletteSelectedIndex].id);
                      setIsPaletteOpen(false);
                    }
                  }}
                  placeholder={t("agentHistory.searchSessions")}
                  className="flex-1 bg-transparent text-sm text-foreground outline-hidden placeholder:text-muted-foreground"
                />
                {paletteQuery && (
                  <button
                    type="button"
                    onClick={() => setPaletteQuery("")}
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={14} />
                  </button>
                )}
              </div>

              {/* Results List */}
              <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                {paletteResults.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    {t("agentHistory.noResultsFor", { query: paletteQuery })}
                  </div>
                ) : (
                  paletteResults.map((s, idx) => {
                    const brand = AGENT_BRANDS[s.agent] || AGENT_BRANDS["claude"];
                    const isSelected = idx === paletteSelectedIndex;

                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          void selectSession(s.id);
                          setIsPaletteOpen(false);
                        }}
                        className={cn(
                          "flex cursor-pointer flex-col gap-1 rounded-xl p-2.5 text-xs transition-colors",
                          isSelected ? "bg-[#27272b] text-foreground" : "hover:bg-[#202024] text-[#dcdce0]",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 truncate font-medium">
                            <img src={brand.icon} alt={brand.name} className="size-3.5 rounded object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                            <span className="truncate">{s.title}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {s.project_name} · {formatRelativeTime(s.updated_at)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Palette Footer */}
              <div className="flex items-center justify-between border-t border-border/40 bg-[#121214] px-4 py-2 text-[10.5px] text-muted-foreground select-none">
                <span>{t("agentHistory.scopeAllSessions")}</span>
                <div className="flex items-center gap-3">
                  <span><kbd className="font-mono">↑↓</kbd> {t("agentHistory.navigate")}</span>
                  <span><kbd className="font-mono">↵</kbd> {t("agentHistory.open")}</span>
                  <span><kbd className="font-mono">{t("agentHistory.escapeKey")}</kbd> {t("agentHistory.close")}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
