import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DEFAULT_COLUMNS,
  type KanbanColumnId,
  type KanbanPriority,
} from "../lib/kanbanTypes";
import { useKanbanStore } from "../store/kanbanStore";
import { KanbanCardItem } from "./KanbanCardItem";

type Props = {
  onRunCommand?: (command: string) => void;
  cwd?: string | null;
};

export function KanbanTab({ onRunCommand, cwd }: Props) {
  const cards = useKanbanStore((s) => s.cards);
  const addCard = useKanbanStore((s) => s.addCard);
  const moveCard = useKanbanStore((s) => s.moveCard);

  const [query, setQuery] = useState("");
  const [activeColInput, setActiveColInput] = useState<KanbanColumnId | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState<KanbanPriority>("medium");
  const [overCol, setOverCol] = useState<KanbanColumnId | null>(null);

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
    setActiveColInput(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Search and control bar */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 bg-muted/10">
        <div className="relative flex-1 max-w-xs">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tarjetas..."
            className="h-7 pl-7 pr-2 text-xs bg-background/50"
          />
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>{cards.length} {cards.length === 1 ? "tarjeta" : "tarjetas"}</span>
        </div>
      </div>

      {/* 4-column Board Grid */}
      <div className="grid flex-1 min-h-0 grid-cols-4 gap-2.5 p-3 overflow-x-auto">
        {DEFAULT_COLUMNS.map((col) => {
          const colCards = cardsByCol[col.id] ?? [];
          const isOver = overCol === col.id;
          const isAdding = activeColInput === col.id;

          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverCol(col.id);
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const cardId = e.dataTransfer.getData("application/voktty-card-id");
                if (cardId) {
                  moveCard(cardId, col.id);
                }
              }}
              className={cn(
                "flex flex-col min-h-0 rounded-lg border border-border/30 bg-muted/15 p-2 transition-colors",
                isOver && "border-primary/50 bg-primary/5",
              )}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-1.5 border-b border-border/20">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-xs text-foreground truncate">
                    {col.title}
                  </span>
                  <span className="flex size-4.5 items-center justify-center rounded-full bg-muted text-[10px] font-mono text-muted-foreground">
                    {colCards.length}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setActiveColInput(isAdding ? null : col.id);
                    setNewTitle("");
                    setNewDesc("");
                  }}
                  title="Nueva tarjeta"
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} />
                </Button>
              </div>

              {/* Inline card creation form */}
              {isAdding && (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-2 shadow-xs">
                  <Input
                    autoFocus
                    placeholder="Titulo de la tarea..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !newDesc)) {
                        e.preventDefault();
                        handleCreate(col.id);
                      }
                      if (e.key === "Escape") {
                        setActiveColInput(null);
                      }
                    }}
                    className="h-7 text-xs"
                  />
                  <textarea
                    placeholder="Detalles, comandos o - [ ] checklists..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex items-center justify-between">
                    <select
                      value={newPriority}
                      onChange={(e) =>
                        setNewPriority(e.target.value as KanbanPriority)
                      }
                      className="rounded border border-border/40 bg-background px-1.5 py-0.5 text-[10px] text-foreground"
                    >
                      <option value="low">Baja</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                      <option value="urgent">Urgente</option>
                    </select>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setActiveColInput(null)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => handleCreate(col.id)}
                      >
                        Crear
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Column Cards List */}
              <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pt-2 min-h-0">
                {colCards.length === 0 && !isAdding ? (
                  <div className="flex flex-1 items-center justify-center p-4 text-center">
                    <span className="text-[11px] text-muted-foreground/50">
                      Sin tarjetas
                    </span>
                  </div>
                ) : (
                  colCards.map((card) => (
                    <KanbanCardItem
                      key={card.id}
                      card={card}
                      onRunCommand={onRunCommand}
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
