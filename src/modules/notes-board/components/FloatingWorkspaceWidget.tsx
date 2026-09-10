import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDraggableModal } from "@/hooks/useDraggableModal";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  GitCompareIcon,
  Layout01Icon,
  Note01Icon,
  Maximize01Icon,
  Minimize01Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { useSourceControl } from "@/modules/source-control/useSourceControl";
import type { TabSummary } from "../lib/agentHandoff";
import { useKanbanStore } from "../store/kanbanStore";
import {
  useNotesBoardStore,
  type WorkspaceTab,
} from "../store/notesBoardStore";
import { GitReviewTab } from "./GitReviewTab";
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
  const resetStorePosition = useNotesBoardStore((s) => s.resetPosition);
  const requestNewNote = useNotesBoardStore((s) => s.requestNewNote);
  const cardCount = useKanbanStore((s) => s.cards.length);
  const sourceControl = useSourceControl(cwd ?? null);
  const changedCount = sourceControl.changedCount;
  const [isMaximized, setIsMaximized] = useState(false);
  const { t } = useTranslation();

  const { position: dragPos, dragHandleProps, resetPosition, setPosition: setDragPos } = useDraggableModal({
    initialPosition: position ?? { x: 0, y: 0 },
    onPositionChange: (pos) => setPosition(pos),
    resetOnClose: false,
  });

  // Keyboard shortcuts: Escape to close, Alt+N for new note, Alt+D for git review
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
        return;
      }
      if (
        (event.altKey && event.key.toLowerCase() === "d") ||
        (event.ctrlKey && event.altKey && event.key.toLowerCase() === "d")
      ) {
        event.preventDefault();
        event.stopPropagation();
        setTab("review");
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, requestNewNote, setTab]);

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setIsMaximized(false);
      resetPosition();
    } else {
      setIsMaximized(true);
      setDragPos({ x: 0, y: 0 });
    }
  }, [isMaximized, resetPosition, setDragPos]);

  const handleResetCenter = useCallback(() => {
    resetPosition();
    resetStorePosition();
  }, [resetPosition, resetStorePosition]);

  const workspaceTabs: {
    id: WorkspaceTab;
    label: string;
    icon: typeof Note01Icon;
    badge?: number;
  }[] = useMemo(
    () => [
      { id: "notes", label: t("notesBoard.tabNotes"), icon: Note01Icon },
      { id: "kanban", label: t("notesBoard.tabKanban"), icon: Layout01Icon, badge: cardCount },
      {
        id: "review",
        label: t("notesBoard.tabReview"),
        icon: GitCompareIcon,
        badge: changedCount > 0 ? changedCount : undefined,
      },
    ],
    [cardCount, changedCount, t],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in-0 duration-100 font-sans"
      onClick={onClose}
    >
      <div
        ref={rootRef}
        tabIndex={0}
        role="dialog"
        aria-modal="true"
        aria-label={t("notesBoard.regionLabel")}
        style={{
          width: isMaximized ? "100vw" : `${Math.min(width, window.innerWidth - 32)}px`,
          height: isMaximized ? "100vh" : `min(${height}px, calc(100vh - 48px))`,
          transform: isMaximized
            ? "none"
            : dragPos.x || dragPos.y
              ? `translate3d(${dragPos.x}px, ${dragPos.y}px, 0)`
              : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-[#161618] text-[#ececed] shadow-2xl outline-none select-none duration-100 animate-in zoom-in-95",
          isMaximized && "rounded-none border-none",
        )}
      >
        {/* Fluent / Wake Top Header - Drag Handle */}
        <div
          {...dragHandleProps}
          className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 bg-[#121214]/90 px-3.5 select-none cursor-grab active:cursor-grabbing"
          title={t("notesBoard.dragToMove")}
        >
          {/* Traffic Dots & Title */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 mr-1.5" data-no-drag>
              <span
                className="size-3 rounded-full bg-rose-500/80 inline-block hover:opacity-80 cursor-pointer transition-opacity"
                onClick={onClose}
                title={t("notesBoard.closeEsc")}
              />
              <span
                className="size-3 rounded-full bg-amber-500/80 inline-block hover:opacity-80 cursor-pointer transition-opacity"
                onClick={handleResetCenter}
                title={t("notesBoard.resetPosition")}
              />
              <span
                className="size-3 rounded-full bg-emerald-500/80 inline-block hover:opacity-80 cursor-pointer transition-opacity"
                onClick={toggleMaximize}
                title={isMaximized ? t("notesBoard.restore") : t("notesBoard.maximize")}
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-foreground">
              <HugeiconsIcon icon={Layout01Icon} size={14} className="text-primary/90" />
              <span>{t("notesBoard.workspace")}</span>
            </div>
          </div>

          {/* Central Segment Tabs */}
          <div className="flex items-center gap-1 rounded-lg bg-[#1a1a1d] p-0.5 border border-border/40 text-xs" data-no-drag>
            {workspaceTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-1.5 cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors font-medium",
                  activeTab === item.id
                    ? "bg-[#28282d] text-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-[#202024] hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={item.icon} size={12} />
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full text-[9.5px] font-mono",
                      item.id === "review"
                        ? "bg-primary/20 text-primary font-bold"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Window Control Buttons */}
          <div className="flex items-center gap-1" data-no-drag>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer rounded-md"
              onClick={handleResetCenter}
              title={t("notesBoard.centerWindow")}
            >
              <HugeiconsIcon icon={PinIcon} size={12} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer rounded-md"
              onClick={toggleMaximize}
              title={isMaximized ? t("notesBoard.restore") : t("notesBoard.maximize")}
            >
              <HugeiconsIcon
                icon={isMaximized ? Minimize01Icon : Maximize01Icon}
                size={12}
              />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-destructive/15 hover:text-destructive cursor-pointer rounded-md"
              onClick={onClose}
              title={t("notesBoard.closeEsc")}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} />
            </Button>
          </div>
        </div>

        {/* Main Tab Content Pane */}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden bg-[#18181b]">
          {activeTab === "review" ? (
            <GitReviewTab
              onRunCommand={onRunCommand}
              cwd={cwd}
              tabs={tabs}
              onActivateAgent={onActivateAgent}
            />
          ) : activeTab === "kanban" ? (
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

        {/* Fluent Bottom Status / Shortcut Bar */}
        <div className="flex h-6 shrink-0 items-center justify-between border-t border-border/30 bg-[#121214]/90 px-3.5 font-mono text-[10px] text-muted-foreground select-none">
          <span>{t("notesBoard.footerHint")}</span>
          <div className="flex items-center gap-2">
            <span>{t("notesBoard.newNoteShortcut")}</span>
            <span>·</span>
            <span>{t("notesBoard.newReviewShortcut")}</span>
            <span>·</span>
            <span>{t("notesBoard.escToClose")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
