import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/modules/i18n";
import {
  historyClear,
  historyDeleteEntry,
  historyExport,
  historyImport,
  historyList,
  type VokttyHistoryEntry,
} from "../block/lib/history";
import {
  getActiveTerminalLeafId,
  submitToLeaf,
  writeToSession,
} from "../lib/useTerminalSession";
import {
  type HistoryShellFilter,
  useCommandHistoryStore,
} from "./commandHistoryStore";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CleanIcon,
  Clock01Icon,
  Copy01Icon,
  Download01Icon,
  PlayIcon,
  Search01Icon,
  TerminalIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

function formatRelativeTime(timestampSec: number): string {
  if (!timestampSec || timestampSec <= 0) return "";
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = nowSec - timestampSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const date = new Date(timestampSec * 1000);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CommandHistoryModal() {
  const { t } = useTranslation();
  const isOpen = useCommandHistoryStore((s) => s.isOpen);
  const closeHistory = useCommandHistoryStore((s) => s.closeHistory);
  const searchQuery = useCommandHistoryStore((s) => s.searchQuery);
  const setSearchQuery = useCommandHistoryStore((s) => s.setSearchQuery);
  const shellFilter = useCommandHistoryStore((s) => s.shellFilter);
  const setShellFilter = useCommandHistoryStore((s) => s.setShellFilter);

  const [entries, setEntries] = useState<VokttyHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"recent" | "frequent">("recent");

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await historyList(searchQuery, shellFilter, 300);
      setEntries(data);
      setSelectedIndex(0);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, shellFilter]);

  useEffect(() => {
    if (isOpen) {
      void loadEntries();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, loadEntries]);

  const sortedEntries = useMemo(() => {
    const list = [...entries];
    if (sortMode === "frequent") {
      list.sort((a, b) => b.count - a.count || b.last - a.last);
    } else {
      list.sort((a, b) => b.last - a.last || b.count - a.count);
    }
    return list;
  }, [entries, sortMode]);

  const handleCopy = useCallback(
    async (cmd: string) => {
      try {
        await navigator.clipboard.writeText(cmd);
        setCopiedCmd(cmd);
        toast.success(t("terminal.history.copiedToast"), {
          description: cmd,
          duration: 2000,
        });
        setTimeout(() => setCopiedCmd((cur) => (cur === cmd ? null : cur)), 2000);
      } catch {
        toast.error(t("terminal.history.copyError"));
      }
    },
    [t],
  );

  const handleInsert = useCallback(
    (cmd: string) => {
      const leafId = getActiveTerminalLeafId();
      if (leafId !== null) {
        writeToSession(leafId, cmd);
        toast.success(t("terminal.history.insertedToast"), {
          description: cmd,
        });
        closeHistory();
      } else {
        void handleCopy(cmd);
      }
    },
    [closeHistory, handleCopy, t],
  );

  const handleRun = useCallback(
    (cmd: string) => {
      const leafId = getActiveTerminalLeafId();
      if (leafId !== null) {
        submitToLeaf(leafId, cmd);
        toast.success(t("terminal.history.executedToast"), {
          description: cmd,
        });
        closeHistory();
      } else {
        void handleCopy(cmd);
      }
    },
    [closeHistory, handleCopy, t],
  );

  const handleDelete = useCallback(
    async (cmd: string) => {
      const ok = await historyDeleteEntry(cmd);
      if (ok) {
        setEntries((prev) => prev.filter((e) => e.cmd !== cmd));
        toast.success(t("terminal.history.deletedToast"));
      }
    },
    [t],
  );

  const handleClear = useCallback(async () => {
    const filter = shellFilter === "all" ? undefined : shellFilter;
    const count = await historyClear(filter);
    setEntries([]);
    toast.success(t("terminal.history.clearedToast", { count }));
  }, [shellFilter, t]);

  const handleExport = useCallback(async () => {
    try {
      const json = await historyExport();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `voktty-history-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("terminal.history.exportedToast"));
    } catch {
      toast.error(t("terminal.history.exportError"));
    }
  }, [t]);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const count = await historyImport(text);
        toast.success(t("terminal.history.importedToast", { count }));
        void loadEntries();
      } catch {
        toast.error(t("terminal.history.importError"));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [loadEntries, t],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < sortedEntries.length - 1 ? prev + 1 : prev,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = sortedEntries[selectedIndex];
      if (item) {
        if (e.shiftKey) handleRun(item.cmd);
        else handleInsert(item.cmd);
      }
    }
  };

  useEffect(() => {
    const active = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeHistory()}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-md border-border/70 shadow-2xl rounded-2xl"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/40 flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <HugeiconsIcon icon={Clock01Icon} size={18} strokeWidth={2} />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
                {t("terminal.history.title")}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {t("terminal.history.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={() => fileInputRef.current?.click()}
            >
              <HugeiconsIcon icon={Upload01Icon} size={14} />
              {t("terminal.history.import")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={handleExport}
            >
              <HugeiconsIcon icon={Download01Icon} size={14} />
              {t("terminal.history.export")}
            </Button>
          </div>
        </DialogHeader>

        {/* Search and Filters Bar */}
        <div className="px-5 py-3 border-b border-border/30 bg-muted/20 flex flex-col gap-2.5">
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("terminal.history.searchPlaceholder")}
              className="pl-9 pr-8 h-9 text-sm font-mono bg-background/60 border-border/60 focus-visible:ring-primary/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: "all", label: t("terminal.history.filterAll") },
                  {
                    id: "unix",
                    label: t("terminal.history.filterUnix"),
                  },
                  {
                    id: "powershell",
                    label: t("terminal.history.filterPowershell"),
                  },
                ] as const
              ).map((tab) => (
                <Button
                  key={tab.id}
                  variant={shellFilter === tab.id ? "secondary" : "ghost"}
                  size="sm"
                  className={`h-7 px-2.5 text-xs rounded-md ${
                    shellFilter === tab.id
                      ? "bg-accent font-medium text-accent-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setShellFilter(tab.id as HistoryShellFilter)}
                >
                  {tab.label}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant={sortMode === "recent" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSortMode("recent")}
              >
                {t("terminal.history.sortRecent")}
              </Button>
              <Button
                variant={sortMode === "frequent" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSortMode("frequent")}
              >
                {t("terminal.history.sortFrequent")}
              </Button>
            </div>
          </div>
        </div>

        {/* History Items List */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto min-h-[300px] max-h-[460px] p-2 space-y-1"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <HugeiconsIcon
                icon={Clock01Icon}
                size={24}
                className="animate-spin text-primary"
              />
              <span className="text-xs">{t("terminal.history.loading")}</span>
            </div>
          ) : sortedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <HugeiconsIcon icon={TerminalIcon} size={28} className="opacity-40" />
              <p className="text-sm font-medium text-foreground/80">
                {t("terminal.history.noResults")}
              </p>
            </div>
          ) : (
            sortedEntries.map((entry, i) => {
              const isSelected = i === selectedIndex;
              const isCopied = copiedCmd === entry.cmd;
              const isPowershell =
                entry.shell_type?.toLowerCase().includes("power") ||
                entry.shell_type?.toLowerCase().includes("pwsh");
              const isUnix =
                entry.shell_type?.toLowerCase().includes("bash") ||
                entry.shell_type?.toLowerCase().includes("zsh") ||
                entry.shell_type?.toLowerCase().includes("unix") ||
                entry.shell_type?.toLowerCase().includes("fish");

              return (
                <div
                  key={`${entry.cmd}-${i}`}
                  data-index={i}
                  onDoubleClick={() => handleCopy(entry.cmd)}
                  onClick={() => setSelectedIndex(i)}
                  className={`group flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-accent/80 text-accent-foreground shadow-xs border border-border/50"
                      : "hover:bg-muted/40 text-foreground/90"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <HugeiconsIcon
                      icon={Clock01Icon}
                      size={14}
                      className="text-muted-foreground/60 shrink-0"
                    />
                    <span className="font-mono text-xs truncate select-text leading-relaxed">
                      {entry.cmd}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Metadata tags */}
                    {isPowershell && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4.5 px-1.5 font-normal bg-sky-500/10 text-sky-400 border-sky-500/20"
                      >
                        PS
                      </Badge>
                    )}
                    {isUnix && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4.5 px-1.5 font-normal bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      >
                        {entry.shell_type}
                      </Badge>
                    )}
                    {entry.category === "ssh" && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4.5 px-1.5 font-normal bg-amber-500/10 text-amber-400 border-amber-500/20"
                      >
                        SSH
                      </Badge>
                    )}
                    {entry.count > 1 && (
                      <span className="text-[10px] font-mono text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
                        x{entry.count}
                      </span>
                    )}
                    {entry.last > 0 && (
                      <span className="text-[10px] text-muted-foreground/60 min-w-[45px] text-right">
                        {formatRelativeTime(entry.last)}
                      </span>
                    )}

                    {/* Action buttons on hover/selection */}
                    <div className="flex items-center gap-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded hover:bg-background/80"
                        title={t("terminal.history.copy")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCopy(entry.cmd);
                        }}
                      >
                        <HugeiconsIcon
                          icon={isCopied ? CheckmarkCircle02Icon : Copy01Icon}
                          size={13}
                          className={isCopied ? "text-emerald-400" : ""}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded hover:bg-background/80"
                        title={t("terminal.history.insert")}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInsert(entry.cmd);
                        }}
                      >
                        <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded hover:bg-primary/20 text-primary"
                        title={t("terminal.history.run")}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRun(entry.cmd);
                        }}
                      >
                        <HugeiconsIcon icon={PlayIcon} size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded hover:bg-destructive/20 text-destructive/80"
                        title={t("terminal.history.delete")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(entry.cmd);
                        }}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={13} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-2.5 border-t border-border/40 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              {sortedEntries.length} {t("terminal.history.countLabel")}
            </span>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="text-destructive/80 hover:text-destructive flex items-center gap-1 hover:underline"
              >
                <HugeiconsIcon icon={CleanIcon} size={12} />
                {t("terminal.history.clearAll")}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] opacity-75">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 text-[10px]">
                ↵
              </kbd>{" "}
              {t("terminal.history.hintInsert")}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 text-[10px]">
                ⇧↵
              </kbd>{" "}
              {t("terminal.history.hintRun")}
            </span>
            <span>
              {t("terminal.history.hintCopy")}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
