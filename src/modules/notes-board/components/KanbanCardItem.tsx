import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Alert02Icon,
  ArrowRight01Icon,
  CancelCircleIcon,
  Cancel01Icon,
  ChatBotIcon,
  CheckmarkCircle02Icon,
  ComputerTerminal01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { KanbanCard, KanbanColumnId } from "../lib/kanbanTypes";
import {
  type ActiveAgentTarget,
  formatExecutionDuration,
  formatTaskForAgent,
} from "../lib/agentHandoff";
import { extractTaskStats, useKanbanStore } from "../store/kanbanStore";

type Props = {
  card: KanbanCard;
  onRunCommand?: (command: string) => void;
  onActivateAgent?: (tabId: number, leafId: number) => void;
  availableAgents?: ActiveAgentTarget[];
  onAssignToAgent?: (card: KanbanCard, target: ActiveAgentTarget) => void;
};

const NEXT_COLUMN: Record<KanbanColumnId, KanbanColumnId | null> = {
  ideas: "todo",
  todo: "in_progress",
  in_progress: "done",
  done: null,
};

const PRIORITY_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  low: {
    bg: "bg-blue-500/10 dark:bg-blue-400/15",
    text: "text-blue-600 dark:text-blue-300",
    label: "Baja",
  },
  medium: {
    bg: "bg-amber-500/10 dark:bg-amber-400/15",
    text: "text-amber-600 dark:text-amber-300",
    label: "Media",
  },
  high: {
    bg: "bg-orange-500/10 dark:bg-orange-400/15",
    text: "text-orange-600 dark:text-orange-300",
    label: "Alta",
  },
  urgent: {
    bg: "bg-red-500/10 dark:bg-red-400/15",
    text: "text-red-600 dark:text-red-300",
    label: "Urgente",
  },
};

export function KanbanCardItem({
  card,
  onRunCommand,
  onActivateAgent,
  availableAgents = [],
  onAssignToAgent,
}: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const deleteCard = useKanbanStore((s) => s.deleteCard);
  const moveCard = useKanbanStore((s) => s.moveCard);
  const unassignCard = useKanbanStore((s) => s.unassignCard);

  const stats = useMemo(
    () => extractTaskStats(card.description),
    [card.description],
  );

  const detectedCommand = useMemo(() => {
    // Check for ```bash ... ``` or `cmd`
    const codeBlockMatch = card.description.match(
      /```(?:sh|bash|pwsh|ps1)?\n([\s\S]*?)```/,
    );
    if (codeBlockMatch?.[1]?.trim()) {
      return codeBlockMatch[1].trim();
    }
    const inlineMatch = card.description.match(/`([^`]+)`/);
    if (inlineMatch?.[1]?.trim()) {
      return inlineMatch[1].trim();
    }
    return null;
  }, [card.description]);

  const priorityMeta = card.priority ? PRIORITY_STYLES[card.priority] : null;
  const nextCol = NEXT_COLUMN[card.columnId];

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/voktty-card-id", card.id);
    const prompt = formatTaskForAgent(card);
    e.dataTransfer.setData("application/voktty-card-prompt", prompt);
    e.dataTransfer.setData("text/plain", prompt);
    e.dataTransfer.effectAllowed = "copyMove";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setAgentMenuOpen(false);
      }}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-lg border border-border/40 bg-card/60 p-2.5 text-xs shadow-xs transition-all hover:border-border/80 hover:bg-card hover:shadow-md cursor-grab active:cursor-grabbing",
        card.columnId === "done" && "opacity-75 bg-card/40",
        (card.assignedExecution?.requiresAttention ||
          card.assignedExecution?.lastObservedStatus === "waiting") &&
          "border-amber-500/60 bg-amber-500/5 ring-1 ring-amber-500/30",
        card.assignedExecution?.lastObservedStatus === "error" &&
          "border-rose-500/50 bg-rose-500/5 ring-1 ring-rose-500/20",
      )}
    >
      {/* Title and actions header */}
      <div className="flex items-start justify-between gap-1.5">
        <span
          className={cn(
            "font-medium leading-snug text-foreground break-words",
            card.columnId === "done" && "line-through text-muted-foreground",
          )}
        >
          {card.title}
        </span>

        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity",
            isHovered || agentMenuOpen ? "opacity-100" : "opacity-0",
          )}
        >
          {nextCol && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-muted-foreground hover:text-foreground"
              onClick={() => moveCard(card.id, nextCol)}
              title="Avanzar columna"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={11} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-destructive"
            onClick={() => deleteCard(card.id)}
            title="Eliminar tarjeta"
          >
            <HugeiconsIcon icon={Delete02Icon} size={11} />
          </Button>
        </div>
      </div>

      {/* Description snippet */}
      {card.description.trim() ? (
        <p className="line-clamp-2 text-[11px] text-muted-foreground break-words">
          {card.description.replace(/```[\s\S]*?```/g, "[codigo]").trim()}
        </p>
      ) : null}

      {/* Attention alert banner */}
      {(card.assignedExecution?.requiresAttention ||
        card.assignedExecution?.lastObservedStatus === "waiting") && (
        <div
          onClick={() =>
            onActivateAgent?.(
              card.assignedExecution!.tabId,
              card.assignedExecution!.leafId,
            )
          }
          className="flex items-center gap-1.5 rounded bg-amber-500/15 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-pointer hover:bg-amber-500/25 transition-colors"
          title="Requiere intervencion en consola. Clic para enfocar la terminal"
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            size={11}
            className="shrink-0 animate-pulse"
          />
          <span className="truncate">Requiere atencion en consola</span>
        </div>
      )}

      {/* Error alert banner */}
      {card.assignedExecution?.lastObservedStatus === "error" && (
        <div className="flex items-center justify-between gap-1.5 rounded bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-600 dark:text-rose-400 border border-rose-500/25">
          <div className="flex items-center gap-1 truncate">
            <HugeiconsIcon
              icon={CancelCircleIcon}
              size={11}
              className="shrink-0"
            />
            <span className="truncate">
              {card.assignedExecution.errorReason ||
                "Terminal cerrada antes de finalizar"}
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              unassignCard(card.id);
            }}
            className="text-rose-600 dark:text-rose-400 underline hover:text-rose-700 cursor-pointer shrink-0 ml-1"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Footer Badges & Actions */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-border/20 text-[10px]">
        <div className="flex flex-wrap items-center gap-1.5">
          {priorityMeta && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-medium",
                priorityMeta.bg,
                priorityMeta.text,
              )}
            >
              {priorityMeta.label}
            </span>
          )}

          {stats.total > 0 && (
            <span
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 font-mono",
                stats.completed === stats.total
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={10} />
              {stats.completed}/{stats.total}
            </span>
          )}

          {/* Assigned Agent Badge */}
          {card.assignedExecution ? (
            <div
              onClick={() =>
                onActivateAgent?.(
                  card.assignedExecution!.tabId,
                  card.assignedExecution!.leafId,
                )
              }
              className={cn(
                "flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium transition-colors cursor-pointer",
                card.assignedExecution.requiresAttention ||
                  card.assignedExecution.lastObservedStatus === "waiting"
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                  : card.assignedExecution.lastObservedStatus === "error"
                    ? "border-rose-500/40 bg-rose-500/15 text-rose-500 hover:bg-rose-500/25"
                    : card.assignedExecution.lastObservedStatus === "idle" ||
                        card.columnId === "done"
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                      : "border-primary/40 bg-primary/15 text-primary hover:bg-primary/25",
              )}
              title={`Asignado a ${card.assignedExecution.agentName} (Pestaña ${card.assignedExecution.tabId}). Clic para enfocar`}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full shrink-0",
                  card.assignedExecution.requiresAttention ||
                    card.assignedExecution.lastObservedStatus === "waiting"
                    ? "bg-amber-500 animate-ping"
                    : card.assignedExecution.lastObservedStatus === "error"
                      ? "bg-rose-500"
                      : card.assignedExecution.lastObservedStatus === "idle" ||
                          card.columnId === "done"
                        ? "bg-emerald-500"
                        : "bg-primary animate-pulse",
                )}
              />
              <span className="truncate max-w-[85px]">
                {card.assignedExecution.agentName}
              </span>
              {card.assignedExecution.durationMs ? (
                <span className="text-[9px] font-mono opacity-80 shrink-0">
                  ({formatExecutionDuration(card.assignedExecution.durationMs)})
                </span>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  unassignCard(card.id);
                }}
                className="ml-0.5 text-muted-foreground hover:text-destructive cursor-pointer"
                title="Desvincular agente"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={9} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {/* Agent execution selector when unassigned */}
          {!card.assignedExecution && onAssignToAgent && (
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAgentMenuOpen((v) => !v);
                }}
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground",
                  agentMenuOpen && "bg-accent text-foreground",
                )}
                title="Ejecutar con agente..."
              >
                <HugeiconsIcon icon={ChatBotIcon} size={11} />
                <span>Agente</span>
              </button>

              {agentMenuOpen && (
                <div
                  className="absolute right-0 bottom-full mb-1 z-30 min-w-[190px] rounded-lg border border-border/80 bg-popover/95 p-1 text-popover-foreground shadow-lg backdrop-blur-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                    Enviar tarea a agente
                  </div>
                  {availableAgents.length === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
                      Sin terminales activas
                    </div>
                  ) : (
                    availableAgents.map((target) => (
                      <button
                        key={`${target.tabId}-${target.leafId}`}
                        type="button"
                        onClick={() => {
                          onAssignToAgent(card, target);
                          setAgentMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <HugeiconsIcon
                            icon={
                              target.agent === "terminal"
                                ? ComputerTerminal01Icon
                                : ChatBotIcon
                            }
                            size={11}
                            className="shrink-0 text-primary"
                          />
                          <span className="font-medium truncate">
                            {target.displayName}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {target.tabTitle}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {detectedCommand && onRunCommand && (
            <button
              type="button"
              onClick={() => onRunCommand(detectedCommand)}
              className="flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 text-foreground hover:bg-accent hover:text-primary transition-colors cursor-pointer"
              title={`Pegar y ejecutar en terminal: ${detectedCommand}`}
            >
              <HugeiconsIcon icon={ComputerTerminal01Icon} size={10} />
              <span>Ejecutar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
