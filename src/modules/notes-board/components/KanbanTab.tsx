import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Add01Icon,
  Download01Icon,
  Search01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { useAgentHandoffTargets, type AgentHandoffTarget } from "@/modules/notes-board/lib/useAgentHandoffTargets";
import { useKanbanVault } from "@/modules/notes-board/lib/useKanbanVault";
import type { VaultTarget } from "@/modules/notes-board/lib/vaultFilesystem";
import {
  COLUMN_TITLE_KEYS,
  DEFAULT_COLUMNS,
  type KanbanCard,
  type KanbanColumnId,
  type KanbanPriority,
} from "../lib/kanbanTypes";
import {
  formatTaskForAgent,
  type TabSummary,
} from "../lib/agentHandoff";
import { useKanbanStore } from "../store/kanbanStore";
import { KanbanCardItem } from "./KanbanCardItem";

type Props = {
  onRunCommand?: (command: string) => void;
  runCommandDisabledReason?: string;
  cwd?: string | null;
  vaultTarget?: VaultTarget | null;
  sourceKey?: string;
  tabs?: TabSummary[];
  onActivateAgent?: (tabId: number, leafId: number) => void;
};

export function KanbanTab({
  onRunCommand,
  runCommandDisabledReason,
  cwd,
  vaultTarget,
  sourceKey,
  tabs,
  onActivateAgent,
}: Props) {
  const { t } = useTranslation();
  const cards = useKanbanStore((s) => s.cards);
  const addCard = useKanbanStore((s) => s.addCard);
  const moveCard = useKanbanStore((s) => s.moveCard);
  const assignCardToAgent = useKanbanStore((s) => s.assignCardToAgent);
  const isObserving = useKanbanStore((s) => s.isObserving);
  const toggleObserving = useKanbanStore((s) => s.toggleObserving);

  const availableAgents = useAgentHandoffTargets(tabs);
  const readyAgentCount = availableAgents.filter((target) => target.submission).length;

  const [query, setQuery] = useState("");
  const [activeColInput, setActiveColInput] = useState<KanbanColumnId | null>(
    null,
  );
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState<KanbanPriority>("medium");
  const [overCol, setOverCol] = useState<KanbanColumnId | null>(null);
  const vault = useKanbanVault(vaultTarget, sourceKey);
  const vaultReasonId = useId();
  const vaultReason = vault.available ? undefined : t("harness.unavailableDirShort");

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [cards, query]);

  const cardsByCol = useMemo(() => {
    const map: Record<KanbanColumnId, typeof cards> = {
      ideas: [],
      todo: [],
      in_progress: [],
      done: [],
    };
    for (const card of filteredCards) {
      if (map[card.columnId]) {
        map[card.columnId].push(card);
      }
    }
    for (const col of Object.keys(map) as KanbanColumnId[]) {
      map[col].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [filteredCards]);

  const handleCreate = (colId: KanbanColumnId) => {
    if (!newTitle.trim()) return;
    addCard({
      title: newTitle.trim(),
      description: newDesc.trim(),
      columnId: colId,
      priority: newPriority,
      sourceCwd: cwd ?? undefined,
    });
    setNewTitle("");
    setNewDesc("");
    setNewPriority("medium");
    setActiveColInput(null);
  };

  const handleAssignToAgent = (card: KanbanCard, target: AgentHandoffTarget) => {
    const prompt = formatTaskForAgent(card);
    if (!target.run(prompt)) return;
    assignCardToAgent(card.id, {
      leafId: target.leafId,
      tabId: target.tabId,
      agentName: target.displayName,
      startedAt: Date.now(),
      lastObservedStatus: target.status === "waiting" ? "waiting" : "working",
    });
    onActivateAgent?.(target.tabId, target.leafId);
  };

  const handleDragOver = (e: React.DragEvent, colId: KanbanColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overCol !== colId) {
      setOverCol(colId);
    }
  };

  const handleDragLeave = (colId: KanbanColumnId) => {
    if (overCol === colId) {
      setOverCol(null);
    }
  };

  const handleDrop = (e: React.DragEvent, colId: KanbanColumnId) => {
    e.preventDefault();
    setOverCol(null);
    const cardId =
      e.dataTransfer.getData("application/voktty-card-id") ||
      e.dataTransfer.getData("text/plain");
    if (cardId) {
      moveCard(cardId, colId);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Board Top Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2 bg-muted/10">
        <div className="relative flex-1 max-w-sm">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("notesBoard.searchCards")}
            className="h-7 pl-8 text-xs bg-background/60"
          />
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-6 px-2 text-[11px] gap-1.5 cursor-pointer transition-colors",
              isObserving
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium hover:bg-emerald-500/20"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={toggleObserving}
            title={
              isObserving
                ? t("notesBoard.observingOn")
                : t("notesBoard.observingOff")
            }
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isObserving ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50",
              )}
            />
            <span>{isObserving ? t("notesBoard.observing") : t("notesBoard.observe")}</span>
          </Button>

          <span>{t("notesBoard.cardsCount", { count: filteredCards.length })}</span>
          {readyAgentCount > 0 && (
            <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary text-[10px] font-medium">
              {t("notesBoard.agentsReady", { count: readyAgentCount })}
            </span>
          )}
            <div className="flex items-center gap-1 border-l border-border/40 pl-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => void vault.run("export", cards)}
                disabled={vault.syncing || !vault.available}
                title={vaultReason ?? t("notesBoard.exportVaultTitle")}
                aria-describedby={vaultReason ? vaultReasonId : undefined}
              >
                <HugeiconsIcon icon={Upload01Icon} size={12} />
                <span>{t("notesBoard.exportVault")}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => void vault.run("import")}
                disabled={vault.syncing || !vault.available}
                title={vaultReason ?? t("notesBoard.importVaultTitle")}
                aria-describedby={vaultReason ? vaultReasonId : undefined}
              >
                <HugeiconsIcon icon={Download01Icon} size={12} />
                <span>{t("notesBoard.importVault")}</span>
              </Button>
              {vaultReason && <span id={vaultReasonId}>{vaultReason}</span>}
            </div>
        </div>
      </div>

      {/* Columns Container */}
      <div className="flex flex-1 gap-2.5 overflow-x-auto p-3 min-h-0">
        {DEFAULT_COLUMNS.map((col) => {
          const colCards = cardsByCol[col.id] || [];
          const isAdding = activeColInput === col.id;
          const isOver = overCol === col.id;

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={() => handleDragLeave(col.id)}
              onDrop={(e) => handleDrop(e, col.id)}
              className={cn(
                "flex flex-1 min-w-[200px] flex-col rounded-xl border border-border/50 bg-muted/25 transition-all duration-150 overflow-hidden",
                isOver && "border-primary/60 bg-primary/5 ring-1 ring-primary/30",
              )}
            >
              {/* Column Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 py-2 bg-muted/30">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-semibold text-xs text-foreground truncate">
                    {t(COLUMN_TITLE_KEYS[col.id])}
                  </span>
                  <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-mono text-muted-foreground font-medium">
                    {colCards.length}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => setActiveColInput(isAdding ? null : col.id)}
                  title={t("notesBoard.newCard")}
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} />
                </Button>
              </div>

              {/* Card Creation Inline Panel */}
              {isAdding && (
                <div className="border-b border-border/40 bg-card p-2.5 flex flex-col gap-2 shadow-xs shrink-0">
                  <Input
                    autoFocus
                    placeholder={t("notesBoard.taskTitlePlaceholder")}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleCreate(col.id);
                      } else if (e.key === "Escape") {
                        setActiveColInput(null);
                      }
                    }}
                    className="h-7 text-xs bg-background"
                  />
                  <textarea
                    placeholder={t("notesBoard.taskDescPlaceholder")}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <div className="flex items-center justify-between gap-1">
                    <select
                      value={newPriority}
                      onChange={(e) =>
                        setNewPriority(e.target.value as KanbanPriority)
                      }
                      className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[11px] text-foreground"
                    >
                      <option value="low">{t("notesBoard.priority.low")}</option>
                      <option value="medium">{t("notesBoard.priority.medium")}</option>
                      <option value="high">{t("notesBoard.priority.high")}</option>
                      <option value="urgent">{t("notesBoard.priority.urgent")}</option>
                    </select>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setActiveColInput(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => handleCreate(col.id)}
                      >
                        {t("common.save")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Column Cards List */}
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 min-h-0">
                {colCards.length === 0 && !isAdding ? (
                  <div className="flex flex-1 items-center justify-center p-4 text-center">
                    <span className="text-[11px] text-muted-foreground/50">
                      {t("notesBoard.emptyColumn")}
                    </span>
                  </div>
                ) : (
                  colCards.map((card) => (
                    <KanbanCardItem
                      key={card.id}
                      card={card}
                      onRunCommand={onRunCommand}
                      runCommandDisabledReason={runCommandDisabledReason}
                      onActivateAgent={onActivateAgent}
                      availableAgents={availableAgents}
                      onAssignToAgent={handleAssignToAgent}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
