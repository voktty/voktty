import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useTranslation } from "@/modules/i18n";
import type { KanbanCard, KanbanColumnId } from "../lib/kanbanTypes";
import { PRIORITY_LABEL_KEYS } from "../lib/kanbanTypes";
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

const PRIORITY_STYLES: Record<string, { bg: string; fg: string }> = {
  low: {
    bg: "bg-blue-500/10 dark:bg-blue-400/15",
    fg: "text-blue-600 dark:text-blue-300",
  },
  medium: {
    bg: "bg-amber-500/10 dark:bg-amber-400/15",
    fg: "text-amber-600 dark:text-amber-300",
  },
  high: {
    bg: "bg-orange-500/10 dark:bg-orange-400/15",
    fg: "text-orange-600 dark:text-orange-300",
  },
  urgent: {
    bg: "bg-red-500/10 dark:bg-red-400/15",
    fg: "text-red-600 dark:text-red-300",
  },
};

export function KanbanCardItem({
  card,
  onRunCommand,
  onActivateAgent,
  availableAgents = [],
  onAssignToAgent,
}: Props) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
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
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "group relative flex flex-col gap-1 rounded-lg border border-border/40 bg-card/60 p-2 text-xs shadow-xs transition-all hover:border-border/80 hover:bg-card hover:shadow-sm cursor-grab active:cursor-grabbing",
        card.columnId === "done" && "opacity-75 bg-card/40",
        (card.assignedExecution?.requiresAttention ||
          card.assignedExecution?.lastObservedStatus === "waiting") &&
          "border-amber-500/50 bg-amber-500/5",
        card.assignedExecution?.lastObservedStatus === "error" &&
          "border-rose-500/50 bg-rose-500/5",
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
            isHovered ? "opacity-100" : "opacity-0",
          )}
        >
          {nextCol && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-muted-foreground hover:text-foreground"
              onClick={() => moveCard(card.id, nextCol)}
              title={t("notesBoard.advanceColumn")}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={11} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-destructive"
            onClick={() => deleteCard(card.id)}
            title={t("notesBoard.deleteCard")}
          >
            <HugeiconsIcon icon={Delete02Icon} size={11} />
          </Button>
        </div>
      </div>

      {/* Description snippet */}
      {card.description.trim() ? (
        <p className="line-clamp-2 text-[11px] text-muted-foreground break-words">
          {card.description.replace(/```[\s\S]*?```/g, t("notesBoard.codePlaceholder")).trim()}
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
          title={t("notesBoard.needsConsoleTitle")}
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            size={11}
            className="shrink-0 animate-pulse"
          />
          <span className="truncate">{t("notesBoard.needsConsole")}</span>
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
                t("notesBoard.terminalClosedEarly")}
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
            {t("common.retry")}
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
                priorityMeta.fg,
              )}
            >
              {card.priority
                ? t(PRIORITY_LABEL_KEYS[card.priority])
                : null}
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
              title={t("notesBoard.assignedTo", {
                agent: card.assignedExecution.agentName,
                tabId: card.assignedExecution.tabId,
              })}
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
                title={t("notesBoard.unassignAgent")}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={9} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {/* Agent execution selector when unassigned */}
          {!card.assignedExecution && onAssignToAgent && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground focus:outline-none"
                  title={t("notesBoard.runWithAgent")}
                >
                  <HugeiconsIcon icon={ChatBotIcon} size={11} />
                  <span>{t("notesBoard.agent")}</span>
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                side="bottom"
                sideOffset={4}
                collisionPadding={8}
                className="w-52 p-1 text-popover-foreground z-50 rounded-lg border border-border/50 bg-popover shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                  {t("notesBoard.sendTaskToAgent")}
                </DropdownMenuLabel>
                {availableAgents.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
                    {t("notesBoard.noActiveTerminals")}
                  </div>
                ) : (
                  availableAgents.map((target) => (
                    <DropdownMenuItem
                      key={`${target.tabId}-${target.leafId}`}
                      onClick={() => onAssignToAgent(card, target)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] cursor-pointer"
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
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {detectedCommand && onRunCommand && (
            <button
              type="button"
              onClick={() => onRunCommand(detectedCommand)}
              className="flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 text-foreground hover:bg-accent hover:text-primary transition-colors cursor-pointer"
              title={t("notesBoard.runInTerminal", { command: detectedCommand })}
            >
              <HugeiconsIcon icon={ComputerTerminal01Icon} size={10} />
              <span>{t("notesBoard.run")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
