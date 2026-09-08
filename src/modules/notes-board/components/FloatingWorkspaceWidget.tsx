import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  Layout01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNotesBoardStore, type WorkspaceTab } from "../store/notesBoardStore";
import { useKanbanStore } from "../store/kanbanStore";
import { KanbanTab } from "./KanbanTab";
import { NotesTab } from "./NotesTab";

type Props = {
  onClose: () => void;
  onRunCommand?: (command: string) => void;
  cwd?: string | null;
};

export function FloatingWorkspaceWidget({ onClose, onRunCommand, cwd }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeTab = useNotesBoardStore((s) => s.activeTab);
  const setTab = useNotesBoardStore((s) => s.setTab);
  const width = useNotesBoardStore((s) => s.width);
  const height = useNotesBoardStore((s) => s.height);
  const cardCount = useKanbanStore((s) => s.cards.length);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const tabs: { id: WorkspaceTab; label: string; icon: typeof Note01Icon; badge?: number }[] = [
    { id: "kanban", label: "Kanban", icon: Layout01Icon, badge: cardCount },
    { id: "notes", label: "Notas & Ideas", icon: Note01Icon },
  ];

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="region"
      aria-label="Notas y Tablero Kanban Flotante"
      style={{
        width: `min(${width}px, calc(100vw - 24px))`,
        height: `min(${height}px, calc(100vh - 64px))`,
      }}
      className="fixed bottom-8 right-3 z-50 flex flex-col overflow-hidden rounded-xl border border-border/60 bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl outline-none ring-1 ring-border/20 transition-all animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3 bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5 text-xs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 cursor-pointer rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={tab.icon} size={12} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9.5px] font-mono text-muted-foreground">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:bg-accent hover:text-destructive cursor-pointer"
            onClick={onClose}
            title="Cerrar (Esc)"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} />
          </Button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "kanban" ? (
          <KanbanTab onRunCommand={onRunCommand} cwd={cwd} />
        ) : (
          <NotesTab onRunCommand={onRunCommand} cwd={cwd} />
        )}
      </div>

      {/* Subtle Footer */}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-border/30 bg-muted/15 px-3 font-mono text-[10px] text-muted-foreground">
        <span>Voktty Workspace Hub · Arrastra tarjetas o pega comandos</span>
        <span>Esc para cerrar</span>
      </div>
    </div>
  );
}

export default FloatingWorkspaceWidget;
