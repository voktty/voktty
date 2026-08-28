import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDraggableModal } from "@/hooks/useDraggableModal";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  SquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { exportSessionMarkdown, getResumeCommand } from "../lib/agentHistoryBridge";
import { useAgentHistoryStore } from "../store/agentHistoryStore";
import type { HistorySession } from "../types";

const AGENT_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  claude: { bg: "bg-purple-500/15", text: "text-purple-400", label: "Claude Code" },
  codex: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Codex" },
  cursor: { bg: "bg-sky-500/15", text: "text-sky-400", label: "Cursor" },
  voktty: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Voktty Agent" },
  gemini: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Gemini / CLI" },
  kimi: { bg: "bg-teal-500/15", text: "text-teal-400", label: "Kimi" },
};

const DEFAULT_WIDTH = 1120;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 680;
const MIN_HEIGHT = 460;

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

  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [size, setSize] = useState({
    width: typeof window !== "undefined" ? Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 80)) : DEFAULT_WIDTH,
    height: typeof window !== "undefined" ? Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 80)) : DEFAULT_HEIGHT,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { position, dragHandleProps, resetPosition, setPosition } = useDraggableModal({
    resetOnClose: true,
  });

  // Debounced search
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

  // Resizing state
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    direction: "both" as "both" | "x" | "y",
  });

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, direction: "both" | "x" | "y") => {
      if (isMaximized) return;
      e.preventDefault();
      e.stopPropagation();

      isResizingRef.current = true;
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: size.width,
        height: size.height,
        direction,
      };

      const handlePointerMove = (ev: PointerEvent) => {
        if (!isResizingRef.current) return;
        const deltaX = ev.clientX - resizeStartRef.current.x;
        const deltaY = ev.clientY - resizeStartRef.current.y;

        const maxAllowedW = window.innerWidth - 30;
        const maxAllowedH = window.innerHeight - 30;

        setSize((prev) => {
          let nextW = prev.width;
          let nextH = prev.height;

          if (resizeStartRef.current.direction === "both" || resizeStartRef.current.direction === "x") {
            nextW = Math.max(MIN_WIDTH, Math.min(maxAllowedW, resizeStartRef.current.width + deltaX * 2));
          }
          if (resizeStartRef.current.direction === "both" || resizeStartRef.current.direction === "y") {
            nextH = Math.max(MIN_HEIGHT, Math.min(maxAllowedH, resizeStartRef.current.height + deltaY * 2));
          }

          return { width: nextW, height: nextH };
        });
      };

      const handlePointerUp = () => {
        isResizingRef.current = false;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [size, isMaximized],
  );

  const toggleMaximize = useCallback(() => {
    setIsMaximized((prev) => {
      const next = !prev;
      if (next) {
        setPosition({ x: 0, y: 0 });
      }
      return next;
    });
  }, [setPosition]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        useAgentHistoryStore.getState().toggleHistory();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setLocalSearch(useAgentHistoryStore.getState().searchQuery);
      const timer = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    } else {
      resetPosition();
      setIsMaximized(false);
    }
  }, [isOpen, resetPosition]);

  if (!isOpen) return null;

  const toggleTool = (msgId: string) => {
    setExpandedTools((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleCopyResume = async (session: HistorySession) => {
    const cmd = await getResumeCommand(session.id);
    if (cmd) {
      await navigator.clipboard.writeText(cmd);
      toast.success("Resume command copied to clipboard!");
    } else {
      toast.error("No resume command available for this session.");
    }
  };

  const handleExportMarkdown = async (session: HistorySession) => {
    const md = await exportSessionMarkdown(session.id);
    if (md) {
      await navigator.clipboard.writeText(md);
      toast.success("Transcript markdown copied to clipboard!");
    }
  };

  const modalStyle = isMaximized
    ? {
        width: "calc(100vw - 32px)",
        height: "calc(100vh - 32px)",
        transform: "translate3d(0, 0, 0)",
      }
    : {
        width: `${size.width}px`,
        height: `${size.height}px`,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "calc(100vh - 24px)",
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeHistory()}>
      <DialogContent
        showCloseButton={false}
        className="!max-w-none !w-auto !h-auto sm:!max-w-none flex flex-col p-0 gap-0 overflow-hidden bg-card text-card-foreground border border-border/80 shadow-2xl rounded-xl transition-shadow select-none"
        style={modalStyle}
      >
        {/* Draggable Header Bar */}
        <DialogHeader
          {...dragHandleProps}
          onDoubleClick={toggleMaximize}
          className="h-11 shrink-0 px-4 border-b border-border/60 bg-muted/40 flex-row items-center justify-between space-y-0 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2.5 pointer-events-none min-w-0">
            <HugeiconsIcon
              icon={Clock01Icon}
              size={16}
              strokeWidth={2}
              className="text-primary shrink-0"
            />
            <DialogTitle className="text-xs font-semibold tracking-tight text-foreground truncate">
              Agent Operational History & Recovery
            </DialogTitle>
            {stats && (
              <Badge variant="outline" className="hidden sm:inline-flex text-[10px] text-muted-foreground font-mono shrink-0">
                {stats.total_sessions} sessions · {stats.total_messages} messages
              </Badge>
            )}
            {isScanning && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-primary animate-pulse font-medium">
                <span className="size-1.5 rounded-full bg-primary" />
                Scanning agent files...
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0" data-no-drag>
            <Button
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
              <span>{isScanning ? "Scanning..." : "Rescan"}</span>
            </Button>

            {/* Maximize / Restore Button */}
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleMaximize}
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
              title={isMaximized ? "Restore Window" : "Maximize Window"}
            >
              <HugeiconsIcon
                icon={isMaximized ? Copy01Icon : SquareIcon}
                size={12}
                strokeWidth={2}
              />
            </Button>

            {/* Close Button */}
            <Button
              size="icon"
              variant="ghost"
              onClick={closeHistory}
              className="size-6 text-muted-foreground hover:text-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer rounded-md"
              title="Close"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
            </Button>
          </div>
        </DialogHeader>

        {/* 2-Column Workspace */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          {/* Left Column: Session Browser & Filters (320px) */}
          <div className="flex w-80 min-w-80 max-w-80 shrink-0 flex-col border-r border-border/60 bg-muted/20 overflow-hidden">
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
                placeholder="Search sessions, prompts or code..."
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
                  {ag === "all" ? "All" : ag}
                </Button>
              ))}
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
              {isLoading && sessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
                  <span>Searching sessions...</span>
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <HugeiconsIcon icon={Clock01Icon} size={24} className="opacity-30 mb-2" />
                  <span>{localSearch ? "No matches found" : "No sessions found"}</span>
                  <span className="text-[10.5px] opacity-70 mt-1">
                    {localSearch ? "Try a different search term" : "Click Rescan to index agent history"}
                  </span>
                  {localSearch && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={handleClearSearch}
                      className="mt-3 text-[11px] h-6"
                    >
                      Clear search
                    </Button>
                  )}
                </div>
              ) : (
                sessions.map((s) => {
                  const badge = AGENT_BADGES[s.agent] || {
                    bg: "bg-zinc-500/15",
                    text: "text-zinc-400",
                    label: s.agent,
                  };
                  const isActive = activeSessionId === s.id;

                  return (
                    <div
                      key={s.id}
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
                            badge.text,
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
                        <span className="truncate max-w-[150px]">📁 {s.project_name}</span>
                        <span>{s.message_count} msgs</span>
                      </div>
                    </div>
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
                      <span>💬 {activeSession.message_count} messages</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {activeSession.can_resume && (
                      <Button
                        size="sm"
                        onClick={() => void handleCopyResume(activeSession)}
                        className="h-6.5 gap-1 px-2.5 text-xs font-semibold cursor-pointer"
                      >
                        <HugeiconsIcon icon={PlayIcon} size={12} />
                        <span>Copy Resume</span>
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleExportMarkdown(activeSession)}
                      className="h-6.5 gap-1 px-2 text-xs bg-background/80 hover:bg-muted cursor-pointer"
                      title="Copy Full Transcript as Markdown"
                    >
                      <HugeiconsIcon icon={Download01Icon} size={12} />
                      <span>Export</span>
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void deleteSession(activeSession.id)}
                      className="size-6.5 text-muted-foreground hover:text-destructive cursor-pointer"
                      title="Delete Session from Index"
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={13} />
                    </Button>
                  </div>
                </div>

                {/* Message Timeline */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 select-text min-h-0">
                  {isLoading ? (
                    <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                      <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
                      <span>Loading transcript messages...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                      <span>No messages recorded in this session transcript</span>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isUser = msg.role === "user";
                      const isTool = msg.role === "tool";

                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex flex-col gap-1.5 rounded-lg border p-3 text-xs leading-relaxed overflow-hidden",
                            isUser
                              ? "border-primary/40 bg-primary/5 ml-6"
                              : isTool
                                ? "border-amber-500/30 bg-amber-500/5 mx-2"
                                : "border-border/70 bg-card mr-6",
                          )}
                        >
                          {/* Message Header */}
                          <div className="flex items-center justify-between text-[11px] font-semibold">
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
                                {isUser ? "👤 User" : isTool ? "⚙️ Tool Invocation" : "🤖 Assistant"}
                              </span>

                              {msg.redacted && (
                                <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 font-mono">
                                  Secrets Redacted
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
                            <div className="whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed break-words overflow-hidden">
                              {msg.content}
                            </div>
                          )}

                          {/* Tool Invocations Accordion */}
                          {msg.tool_name && (
                            <div className="mt-1 rounded border border-border/50 bg-muted/30 overflow-hidden">
                              <div
                                onClick={() => toggleTool(msg.id)}
                                className="flex cursor-pointer items-center justify-between px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <HugeiconsIcon
                                    icon={expandedTools[msg.id] ? ArrowDown01Icon : ArrowRight01Icon}
                                    size={11}
                                  />
                                  <span className="truncate">Tool: <strong>{msg.tool_name}</strong></span>
                                </div>
                                {msg.is_error && (
                                  <Badge variant="outline" className="text-[9px] text-rose-500 border-rose-500/30 font-mono shrink-0">
                                    Error
                                  </Badge>
                                )}
                              </div>

                              {expandedTools[msg.id] && (
                                <div className="border-t border-border/40 p-2 space-y-2 text-[10.5px] font-mono">
                                  {msg.tool_input && (
                                    <div>
                                      <div className="text-muted-foreground/60 mb-0.5">Input:</div>
                                      <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-foreground border border-border/40 whitespace-pre-wrap break-all">
                                        {msg.tool_input}
                                      </pre>
                                    </div>
                                  )}

                                  {msg.tool_output && (
                                    <div>
                                      <div className="text-muted-foreground/60 mb-0.5">Output:</div>
                                      <pre className="max-h-48 overflow-auto rounded bg-background p-2 text-foreground border border-border/40 whitespace-pre-wrap break-all">
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
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground/70">
                <HugeiconsIcon icon={Clock01Icon} size={32} strokeWidth={1.5} className="opacity-40 mb-2" />
                <span className="text-xs font-semibold text-foreground/80">Select a session to view transcript</span>
                <span className="text-[11px] max-w-sm mt-1">
                  Search across your coding agent conversations or press <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] border border-border/60">Ctrl+Shift+H</kbd> anytime.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Resizing Edge & Corner Handles */}
        {!isMaximized && (
          <>
            {/* Right edge */}
            <div
              onPointerDown={(e) => handleResizeStart(e, "x")}
              className="absolute top-0 right-0 w-2 h-full cursor-ew-resize hover:bg-primary/20 transition-colors z-50"
            />
            {/* Bottom edge */}
            <div
              onPointerDown={(e) => handleResizeStart(e, "y")}
              className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize hover:bg-primary/20 transition-colors z-50"
            />
            {/* Bottom-right corner */}
            <div
              onPointerDown={(e) => handleResizeStart(e, "both")}
              className="absolute bottom-0 right-0 size-4 cursor-nwse-resize hover:bg-primary/30 z-50 flex items-center justify-center"
            >
              <div className="size-2 border-r-2 border-b-2 border-muted-foreground/50 rounded-br-xs" />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}