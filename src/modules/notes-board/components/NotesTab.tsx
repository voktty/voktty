import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Add01Icon,
  ChatBotIcon,
  ComputerTerminal01Icon,
  Copy01Icon,
  Delete02Icon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { submitToLeaf } from "@/modules/terminal";
import {
  deleteNote,
  loadNotes,
  upsertNote,
  type Note,
} from "@/modules/harness/lib/notes";
import {
  type ActiveAgentTarget,
  formatTaskForAgent,
  resolveActiveAgentTargets,
  type TabSummary,
} from "../lib/agentHandoff";
import { useKanbanStore } from "../store/kanbanStore";
import { useNotesBoardStore } from "../store/notesBoardStore";

type Props = {
  onRunCommand?: (command: string) => void;
  cwd?: string | null;
  tabs?: TabSummary[];
  onActivateAgent?: (tabId: number, leafId: number) => void;
};

export function NotesTab({
  onRunCommand,
  cwd,
  tabs,
  onActivateAgent,
}: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const convertNoteToCard = useKanbanStore((s) => s.convertNoteToCard);
  const setTab = useNotesBoardStore((s) => s.setTab);
  const pendingNewNote = useNotesBoardStore((s) => s.pendingNewNote);
  const clearPendingNewNote = useNotesBoardStore((s) => s.clearPendingNewNote);

  const agentSessions = useAgentStore((s) => s.sessions);
  const availableAgents = useMemo(
    () => resolveActiveAgentTargets(agentSessions, tabs),
    [agentSessions, tabs],
  );

  const refreshNotes = useCallback(async () => {
    try {
      const list = await loadNotes(true);
      setNotes(list);
      if (list.length > 0 && (!selectedId || !list.some((n) => n.id === selectedId))) {
        setSelectedId(list[0].id);
        setTitle(list[0].title);
        setBody(list[0].body);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  useEffect(() => {
    if (selectedNote) {
      setTitle(selectedNote.title);
      setBody(selectedNote.body);
    }
  }, [selectedNote]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [notes, query]);

  // Quick note: creates and immediately persists note to disk, then focuses title
  const handleCreateAndSave = useCallback(
    async (initialTitle?: string, initialBody?: string) => {
      const now = Date.now();
      const newDraft: Note = {
        id: `note_${now}`,
        slug: `note-${now.toString(36)}`,
        title: initialTitle ?? "Nueva Nota",
        body: initialBody ?? "",
        sourceCwd: cwd ?? undefined,
        createdAt: now,
        updatedAt: now,
      };
      await upsertNote(newDraft);
      await refreshNotes();
      setSelectedId(newDraft.id);
      setTitle(newDraft.title);
      setBody(newDraft.body);
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 50);
    },
    [cwd, refreshNotes],
  );

  // Triggered via global store request (e.g. statusbar Alt+N)
  useEffect(() => {
    if (pendingNewNote) {
      clearPendingNewNote();
      void handleCreateAndSave();
    }
  }, [pendingNewNote, clearPendingNewNote, handleCreateAndSave]);

  // Keyboard shortcut Alt+N within the notes tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.altKey && e.key.toLowerCase() === "n") ||
        (e.ctrlKey && e.altKey && e.key.toLowerCase() === "n")
      ) {
        e.preventDefault();
        e.stopPropagation();
        void handleCreateAndSave();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handleCreateAndSave]);

  const handleSave = async () => {
    if (!selectedId) return;
    const noteUpsert = {
      id: selectedId,
      title: title.trim() || "Sin titulo",
      body,
      sourceCwd: cwd ?? undefined,
    };
    await upsertNote(noteUpsert);
    await refreshNotes();
  };

  const handleDelete = async (id: string) => {
    await deleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setTitle("");
      setBody("");
    }
  };

  const handleConvertToKanban = () => {
    if (!selectedNote && !title.trim()) return;
    const noteData = {
      id: selectedId || `note_${Date.now()}`,
      title: title.trim() || "Nota",
      body,
      sourceCwd: cwd ?? undefined,
    };
    convertNoteToCard(noteData, "ideas", "medium");
    setTab("kanban");
  };

  const detectedCommand = useMemo(() => {
    const match = body.match(/```(?:sh|bash|pwsh|ps1)?\n([\s\S]*?)```/) || body.match(/`([^`]+)`/);
    return match?.[1]?.trim() ?? null;
  }, [body]);

  const handleSendToAgent = (target: ActiveAgentTarget, forceCommand = false) => {
    let payload = "";
    if (forceCommand && detectedCommand) {
      payload = detectedCommand;
    } else if (detectedCommand && !body.trim().includes("\n\n")) {
      payload = detectedCommand;
    } else {
      payload = formatTaskForAgent({
        title: title.trim() || "Nota",
        description: body.trim(),
      });
    }

    submitToLeaf(target.leafId, payload);
    onActivateAgent?.(target.tabId, target.leafId);
    toast.success(`Enviado a ${target.displayName} (${target.tabTitle})`);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      {/* Sidebar list of notes */}
      <div className="flex w-56 shrink-0 flex-col border-r border-border/30 bg-muted/10">
        <div className="flex h-10 items-center justify-between border-b border-border/30 px-2.5 gap-1.5">
          <div className="relative flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar notas..."
              className="h-7 pl-6 pr-2 text-xs bg-background/50"
            />
            <HugeiconsIcon
              icon={Search01Icon}
              size={11}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => void handleCreateAndSave()}
            title="Crear y guardar nueva nota (Alt+N)"
          >
            <HugeiconsIcon icon={Add01Icon} size={13} />
          </Button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto p-1.5 gap-1">
          {filteredNotes.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {loading ? "Cargando..." : "No hay notas"}
            </div>
          ) : (
            filteredNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => {
                  setSelectedId(note.id);
                  setTitle(note.title);
                  setBody(note.body);
                }}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                  selectedId === note.id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="truncate font-medium text-foreground">
                  {note.title || "Sin titulo"}
                </span>
                <span className="truncate text-[10.5px] text-muted-foreground/70">
                  {note.body.slice(0, 40) || "Nota vacia"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main editor area */}
      {selectedId ? (
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-background p-3">
          {/* Action Header */}
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/20">
            <Input
              ref={titleInputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSave}
              placeholder="Titulo de la nota o comando..."
              className="h-7 text-xs font-semibold"
            />

            <div className="flex items-center gap-1 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px] font-medium cursor-pointer"
                    title="Enviar nota o comando a un agente CLI activo"
                  >
                    <HugeiconsIcon icon={ChatBotIcon} size={12} className="text-primary" />
                    <span>Enviar a agente</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="bottom"
                  sideOffset={4}
                  className="w-56 p-1 text-popover-foreground z-50 rounded-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                    Enviar a agente o terminal activo
                  </DropdownMenuLabel>
                  {availableAgents.length === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
                      Sin terminales o agentes activos
                    </div>
                  ) : (
                    availableAgents.map((target) => (
                      <DropdownMenuItem
                        key={`${target.tabId}-${target.leafId}`}
                        onClick={() => handleSendToAgent(target)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <HugeiconsIcon
                            icon={
                              target.agent === "terminal"
                                ? ComputerTerminal01Icon
                                : ChatBotIcon
                            }
                            size={12}
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
                  {detectedCommand && availableAgents.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                        Solo comando detectado:
                      </DropdownMenuLabel>
                      {availableAgents.map((target) => (
                        <DropdownMenuItem
                          key={`cmd-${target.tabId}-${target.leafId}`}
                          onClick={() => handleSendToAgent(target, true)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[10.5px] cursor-pointer"
                        >
                          <span className="font-mono text-primary truncate">
                            {detectedCommand.slice(0, 24)}
                          </span>
                          <span className="text-[9.5px] text-muted-foreground shrink-0">
                            en {target.tabTitle}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px] font-medium"
                onClick={handleConvertToKanban}
                title="Convertir esta nota en una tarjeta del tablero Kanban"
              >
                <HugeiconsIcon icon={SparklesIcon} size={12} className="text-primary" />
                <span>A Kanban</span>
              </Button>

              {detectedCommand && onRunCommand && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => onRunCommand(detectedCommand)}
                  title={`Ejecutar en terminal: ${detectedCommand}`}
                >
                  <HugeiconsIcon icon={ComputerTerminal01Icon} size={12} />
                  <span>Ejecutar</span>
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(body || title);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                title={copied ? "Copiado!" : "Copiar texto"}
              >
                <HugeiconsIcon icon={Copy01Icon} size={13} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(selectedId)}
                title="Eliminar nota"
              >
                <HugeiconsIcon icon={Delete02Icon} size={13} />
              </Button>
            </div>
          </div>

          {/* Text Area */}
          <div className="flex flex-1 flex-col pt-2 min-h-0">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={handleSave}
              placeholder="Escribe notas en Markdown, comandos o ideas..."
              className="flex-1 resize-none rounded-lg border border-border/40 bg-muted/10 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-muted-foreground">
          Selecciona una nota de la izquierda o crea una nueva
        </div>
      )}
    </div>
  );
}
