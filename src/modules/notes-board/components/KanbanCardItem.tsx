import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  ComputerTerminal01Icon,
  Delete02Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { KanbanCard, KanbanColumnId } from "../lib/kanbanTypes";
import { extractTaskStats, useKanbanStore } from "../store/kanbanStore";

type Props = {
  card: KanbanCard;
  onRunCommand?: (command: string) => void;
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

export function KanbanCardItem({ card, onRunCommand }: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const deleteCard = useKanbanStore((s) => s.deleteCard);
  const moveCard = useKanbanStore((s) => s.moveCard);

  const stats = useMemo(
    () => extractTaskStats(card.description),
    [card.description],
  );

  const detectedCommand = useMemo(() => {
    // Check for ```bash ... ``` or `cmd`
    const codeBlockMatch = card.description.match(/```(?:sh|bash|pwsh|ps1)?\n([\s\S]*?)```/);
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
    e.dataTransfer.setData("text/plain", card.id);
    e.dataTransfer.setData("application/voktty-card-id", card.id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-lg border border-border/40 bg-card/60 p-2.5 text-xs shadow-xs transition-all hover:border-border/80 hover:bg-card hover:shadow-md cursor-grab active:cursor-grabbing",
        card.columnId === "done" && "opacity-75 bg-card/40",
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

      {/* Footer Badges & Actions */}
      <div className="mt-1 flex items-center justify-between gap-1 pt-1 border-t border-border/20 text-[10px]">
        <div className="flex items-center gap-1.5">
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
        </div>

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
  );
}
