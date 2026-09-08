import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Layout01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import type { TabSummary } from "../lib/agentHandoff";
import { useKanbanStore } from "../store/kanbanStore";
import {
  useNotesBoardStore,
  type WorkspaceTab,
} from "../store/notesBoardStore";
import { KanbanTab } from "./KanbanTab";
import { NotesTab } from "./NotesTab";

type Props = {
  onClose: () => void;
  onRunCommand?: (command: string) => void;
  cwd?: string | null;
  tabs?: TabSummary[];
  onActivateAgent?: (tabId: number, leafId: number) => void;
};

export function FloatingWorkspaceWidget({
  onClose,
  onRunCommand,
  cwd,
  tabs,
  onActivateAgent,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeTab = useNotesBoardStore((s) => s.activeTab);
  const setTab = useNotesBoardStore((s) => s.setTab);
  const width = useNotesBoardStore((s) => s.width);
  const height = useNotesBoardStore((s) => s.height);
  const position = useNotesBoardStore((s) => s.position);
  const setPosition = useNotesBoardStore((s) => s.setPosition);
  const resetPosition = useNotesBoardStore((s) => s.resetPosition);
  const requestNewNote = useNotesBoardStore((s) => s.requestNewNote);
  const cardCount = useKanbanStore((s) => s.cards.length);
  const [isDragging, setIsDragging] = useState(false);
  const { t } = useTranslation();

  const isFloating = position !== null;

  // Keyboard shortcuts: Escape to close, Alt+N for quick new note
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (
        (event.altKey && event.key.toLowerCase() === "n") ||
        (event.ctrlKey && event.altKey && event.key.toLowerCase() === "n")
      ) {
        event.preventDefault();
        event.stopPropagation();
        requestNewNote();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, requestNewNote]);

  // Keep floating window clamped within viewport on resize
  useEffect(() => {
    const onResize = () => {
      if (!position) return;
      const maxX = Math.max(8, window.innerWidth - width - 8);
      const maxY = Math.max(8, window.innerHeight - height - 8);
      if (position.x > maxX || position.y > maxY) {
        setPosition({
          x: Math.min(position.x, maxX),
          y: Math.min(position.y, maxY),
        });
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position, width, height, setPosition]);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, a, [role=button], [role=tab]")) {
      return;
    }

    e.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initialLeft = rect.left;
    const initialTop = rect.top;
    const elWidth = rect.width;
    const elHeight = rect.height;

    setIsDragging(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const maxX = Math.max(8, window.innerWidth - elWidth - 8);
      const maxY = Math.max(8, window.innerHeight - elHeight - 8);
      const nextX = Math.max(8, Math.min(maxX, initialLeft + deltaX));
      const nextY = Math.max(8, Math.min(maxY, initialTop + deltaY));

      setPosition({ x: nextX, y: nextY });
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleToggleFloat = useCallback(() => {
    if (isFloating) {
      resetPosition();
    } else {
      const centerX = Math.max(8, Math.round((window.innerWidth - width) / 2));
      const centerY = Math.max(8, Math.round((window.innerHeight - height) / 2));
      setPosition({ x: centerX, y: centerY });
    }
  }, [isFloating, resetPosition, setPosition, width, height]);

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, a, [role=button], [role=tab]")) {
      return;
    }
    handleToggleFloat();
  };

  const workspaceTabs: {
    id: WorkspaceTab;
    label: string;
    icon: typeof Note01Icon;
    badge?: number;
  }[] = [
    { id: "notes", label: t("notesBoard.tabNotes"), icon: Note01Icon },
    { id: "kanban", label: t("notesBoard.tabKanban"), icon: Layout01Icon, badge: cardCount },
  ];

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="region"
      aria-label={t("notesBoard.regionLabel")}
      style={
        isFloating
          ? {
              left: position.x,
              top: position.y,
              width: Math.min(width, window.innerWidth - 16),
              height: `min(${height}px, calc(100vh - 48px))`,
            }
          : {
              height: `min(${height}px, calc(100vh - 64px))`,
            }
      }
      className={cn(
        "z-50 flex flex-col overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-2xl outline-none ring-1 ring-border/25 transition-all duration-150",
        isFloating
          ? "fixed"
          : "fixed bottom-8.5 left-3 right-3 animate-in fade-in slide-in-from-bottom-2",
        isDragging && "select-none ring-2 ring-primary/40",
      )}
    >
      {/* Header bar - serves as drag handle */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
        className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3 bg-muted/20 cursor-move select-none"
        title={t("notesBoard.dragToMove")}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5 text-xs">
            {workspaceTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-1.5 cursor-pointer rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  activeTab === item.id
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={item.icon} size={12} />
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9.5px] font-mono text-muted-foreground">
                    {item.badge}
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
            className="size-6 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            onClick={handleToggleFloat}
            title={
              isFloating
                ? t("notesBoard.dockBelow")
                : t("notesBoard.undockWindow")
            }
          >
            <HugeiconsIcon
              icon={isFloating ? ArrowDown01Icon : ArrowUp01Icon}
              size={13}
            />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:bg-accent hover:text-destructive cursor-pointer"
            onClick={onClose}
            title={t("notesBoard.closeEsc")}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} />
          </Button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "kanban" ? (
          <KanbanTab
            onRunCommand={onRunCommand}
            cwd={cwd}
            tabs={tabs}
            onActivateAgent={onActivateAgent}
          />
        ) : (
          <NotesTab
            onRunCommand={onRunCommand}
            cwd={cwd}
            tabs={tabs}
            onActivateAgent={onActivateAgent}
          />
        )}
      </div>

      {/* Subtle Footer */}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-border/30 bg-muted/15 px-3 font-mono text-[10px] text-muted-foreground">
        <span>{t("notesBoard.footerHint")}</span>
        <div className="flex items-center gap-2">
          <span>{t("notesBoard.newNoteShortcut")}</span>
          <span>·</span>
          <span>{t("notesBoard.escToClose")}</span>
        </div>
      </div>
    </div>
  );
}
