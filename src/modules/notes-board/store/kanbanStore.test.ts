import { beforeEach, describe, expect, it } from "vitest";
import {
  extractTaskStats,
  useKanbanStore,
} from "./kanbanStore";

describe("kanbanStore", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    useKanbanStore.getState().resetCards([]);
  });

  it("adds cards to a specific column with correct ordering", () => {
    const card1 = useKanbanStore.getState().addCard({
      title: "Primera Tarea",
      description: "Descripcion",
      columnId: "todo",
      priority: "high",
    });

    expect(card1.id).toBeDefined();
    expect(card1.columnId).toBe("todo");
    expect(card1.order).toBe(0);

    const card2 = useKanbanStore.getState().addCard({
      title: "Segunda Tarea",
      description: "Otra",
      columnId: "todo",
      priority: "medium",
    });

    expect(card2.order).toBe(1);
    expect(useKanbanStore.getState().cards).toHaveLength(2);
  });

  it("updates card fields", () => {
    const card = useKanbanStore.getState().addCard({
      title: "Tarea Inicial",
      description: "Init",
      columnId: "ideas",
    });

    useKanbanStore.getState().updateCard(card.id, {
      title: "Tarea Modificada",
      priority: "urgent",
    });

    const updated = useKanbanStore
      .getState()
      .cards.find((c) => c.id === card.id);
    expect(updated?.title).toBe("Tarea Modificada");
    expect(updated?.priority).toBe("urgent");
  });

  it("moves a card between columns", () => {
    const card = useKanbanStore.getState().addCard({
      title: "Moverme",
      description: "Cuerpo",
      columnId: "ideas",
    });

    useKanbanStore.getState().moveCard(card.id, "in_progress");

    const moved = useKanbanStore
      .getState()
      .cards.find((c) => c.id === card.id);
    expect(moved?.columnId).toBe("in_progress");
  });

  it("converts a note into a Kanban card", () => {
    const note = {
      id: "note-123",
      title: "Mi Idea de Comando",
      body: "```bash\npnpm test\n```",
      sourceCwd: "/workspace/project",
    };

    const card = useKanbanStore.getState().convertNoteToCard(note, "ideas", "high");

    expect(card.title).toBe("Mi Idea de Comando");
    expect(card.description).toBe("```bash\npnpm test\n```");
    expect(card.columnId).toBe("ideas");
    expect(card.sourceNoteId).toBe("note-123");
    expect(card.sourceCwd).toBe("/workspace/project");
    expect(card.priority).toBe("high");
  });

  it("deletes a card", () => {
    const card = useKanbanStore.getState().addCard({
      title: "Eliminar",
      description: "",
      columnId: "todo",
    });

    expect(useKanbanStore.getState().cards).toHaveLength(1);
    useKanbanStore.getState().deleteCard(card.id);
    expect(useKanbanStore.getState().cards).toHaveLength(0);
  });

  it("extracts task checklist stats correctly from markdown", () => {
    const md = `
# Lista
- [ ] Tarea 1
- [x] Tarea 2 terminada
- [X] Tarea 3 mayuscula
- [ ] Tarea 4 pendiente
texto cualquiera
`;
    const stats = extractTaskStats(md);
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(2);
  });
});
