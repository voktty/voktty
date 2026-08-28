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
  Delete02Icon,
  Download01Icon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const { position, dragHandleProps, resetPosition } = useDraggableModal(isOpen);

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
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      resetPosition();
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeHistory()}>
      <DialogContent
        className="max-w-5xl w-[92vw] h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-card text-card-foreground border border-border/80 shadow-2xl rounded-xl transition-shadow select-none"
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
      >
        {/* Draggable Header Bar */}
        <DialogHeader
          {...dragHandleProps}
          className="h-11 shrink-0 px-4 border-b border-border/60 bg-muted/40 flex-row items-center justify-between space-y-0 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2.5 pointer-events-none min-w-0">
            <HugeiconsIcon
              icon={Clock01Icon}
              size={16}
              strokeWidth={2}
              className="text-primary shrink-0"
            />
            <DialogTitle className="text-xs font-semibold tracking-tight text-foreground">
              Agent Operational History & Recovery
            </DialogTitle>
            {stats && (
              <Badge variant="outline" className="hidden sm:inline-flex text-[10px] text-muted-foreground font-mono">
                {stats.total_sessions} sessions · {stats.total_messages} messages
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pr-6">
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
          </div>
        </DialogHeader>

        {/* 2-Column Solid Workspace */}
        <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
          {/* Left Column: Session Browser & Filters (310px) */}
          <div className="flex w-78 shrink-0 flex-col border-r border-border/60 bg-muted/20">
            {/* Search Box */}
            <div className="relative border-b border-border/40 p-2">
              <HugeiconsIcon
                icon={Search01Icon}
                size={13}
                className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sessions or content..."
                className="h-7.5 pl-7 pr-7 text-xs bg-background border-border/70 rounded-md focus-visible:ring-1 focus-visible:ring-primary/40"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} />
                </button>
              )}
            </div>

            {/* Agent Filter Pills */}
            <div className="flex flex-wrap gap-1 border-b border-border/40 p-2 bg-muted/30">
              {["all", "claude", "codex", "gemini", "cursor", "voktty"].map((ag) => (
                <Button
                  key={ag}
                  size="xs"
                  variant={selectedAgent === ag ? "secondary" : "ghost"}
                  onClick={() => setSelectedAgent(ag)}
                  className={cn(
                    "h-5.5 px-2 text-[10.5px] capitalize font-medium cursor-pointer",
                    selectedAgent === ag && "shadow-xs border border-border/50",
                  )}
                >
                  {ag === "all" ? "All" : ag}
                </Button>
              ))}
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {sessions.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  <span>No sessions found</span>
                  <span className="text-[10px] opacity-70 mt-1">Try clicking Rescan or clear filters</span>
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

                      <span className="line-clamp-2 font-medium leading-snug text-foreground">
                        {s.title}
                      </span>

                      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground mt-0.5">
                        <span className="truncate max-w-[140px]">📁 {s.project_name}</span>
                        <span>{s.message_count} msgs</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Transcript View & Action Bar */}
          <div className="flex flex-1 flex-col overflow-hidden bg-background">
            {activeSession ? (
              <>
                {/* Detail Action Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2">
                  <div className="flex min-w-0 flex-col">
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

                  <div className="flex items-center gap-1.5">
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
                <div className="flex-1 overflow-y-auto p-4 space-y-3 select-text">
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
                            "flex flex-col gap-1.5 rounded-lg border p-3 text-xs leading-relaxed",
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
                            <div className="whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">
                              {msg.content}
                            </div>
                          )}

                          {/* Tool Invocations Accordion */}
                          {msg.tool_name && (
                            <div className="mt-1 rounded border border-border/50 bg-muted/30">
                              <div
                                onClick={() => toggleTool(msg.id)}
                                className="flex cursor-pointer items-center justify-between px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                              >
                                <div className="flex items-center gap-1.5">
                                  <HugeiconsIcon
                                    icon={expandedTools[msg.id] ? ArrowDown01Icon : ArrowRight01Icon}
                                    size={11}
                                  />
                                  <span>Tool: <strong>{msg.tool_name}</strong></span>
                                </div>
                                {msg.is_error && (
                                  <Badge variant="outline" className="text-[9px] text-rose-500 border-rose-500/30 font-mono">
                                    Error
                                  </Badge>
                                )}
                              </div>

                              {expandedTools[msg.id] && (
                                <div className="border-t border-border/40 p-2 space-y-2 text-[10.5px] font-mono">
                                  {msg.tool_input && (
                                    <div>
                                      <div className="text-muted-foreground/60 mb-0.5">Input:</div>
                                      <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-foreground border border-border/40">
                                        {msg.tool_input}
                                      </pre>
                                    </div>
                                  )}

                                  {msg.tool_output && (
                                    <div>
                                      <div className="text-muted-foreground/60 mb-0.5">Output:</div>
                                      <pre className="max-h-48 overflow-auto rounded bg-background p-2 text-foreground border border-border/40">
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
      </DialogContent>
    </Dialog>
  );
}