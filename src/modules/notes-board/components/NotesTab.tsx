import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Add01Icon,
  ComputerTerminal01Icon,
  Copy01Icon,
  Delete02Icon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  deleteNote,
  loadNotes,
  upsertNote,
  type Note,
} from "@/modules/harness/lib/notes";
import { useKanbanStore } from "../store/kanbanStore";
import { useNotesBoardStore } from "../store/notesBoardStore";

type Props = {
  onRunCommand?: (command: string) => void;
  cwd?: string | null;
};

export function NotesTab({ onRunCommand, cwd }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  const convertNoteToCard = useKanbanStore((s) => s.convertNoteToCard);
  const setTab = useNotesBoardStore((s) => s.setTab);

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

  const handleCreateNew = () => {
    const newDraft: Note = {
      id: `note_${Date.now()}`,
      slug: `note-${Date.now().toString(36)}`,
      title: "Nueva Nota",
      body: "",
      sourceCwd: cwd ?? undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setNotes((prev) => [newDraft, ...prev]);
    setSelectedId(newDraft.id);
    setTitle(newDraft.title);
    setBody("");
  };

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
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleCreateNew}
            title="Crear nueva nota"
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSave}
              placeholder="Titulo de la nota o comando..."
              className="h-7 text-xs font-semibold"
            />

            <div className="flex items-center gap-1 shrink-0">
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
