import { create } from "zustand";
import type {
  KanbanCard,
  KanbanColumnId,
  KanbanPriority,
} from "../lib/kanbanTypes";

const STORAGE_KEY = "voktty-kanban-cards-v1";

type KanbanStoreState = {
  cards: KanbanCard[];
  addCard: (
    input: Omit<KanbanCard, "id" | "createdAt" | "updatedAt" | "order">,
  ) => KanbanCard;
  updateCard: (id: string, patch: Partial<Omit<KanbanCard, "id">>) => void;
  deleteCard: (id: string) => void;
  moveCard: (
    id: string,
    targetColumnId: KanbanColumnId,
    targetIndex?: number,
  ) => void;
  convertNoteToCard: (
    note: {
      id: string;
      title: string;
      body: string;
      sourceCwd?: string;
    },
    targetColumnId?: KanbanColumnId,
    priority?: KanbanPriority,
  ) => KanbanCard;
  clearCompleted: () => void;
  assignCardToAgent: (
    id: string,
    execution: {
      leafId: number;
      tabId: number;
      agentName: string;
      startedAt: number;
      lastObservedStatus: "working" | "waiting" | "idle";
    },
  ) => void;
  unassignCard: (id: string) => void;
  updateCardExecutionStatus: (
    id: string,
    status: "working" | "waiting" | "idle",
  ) => void;
  resetCards: (cards: KanbanCard[]) => void;
};

function loadStoredCards(): KanbanCard[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function persistCards(cards: KanbanCard[]) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // Ignore storage quota or disabled storage
  }
}

export const useKanbanStore = create<KanbanStoreState>((set) => ({
  cards: loadStoredCards(),

  addCard: (input) => {
    const now = Date.now();
    const id = `card_${now}_${Math.random().toString(36).slice(2, 7)}`;
    let created: KanbanCard = {
      ...input,
      id,
      order: 0,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      const columnCards = state.cards.filter(
        (c) => c.columnId === input.columnId,
      );
      created = { ...created, order: columnCards.length };
      const next = [...state.cards, created];
      persistCards(next);
      return { cards: next };
    });

    return created;
  },

  updateCard: (id, patch) => {
    set((state) => {
      const next = state.cards.map((card) =>
        card.id === id ? { ...card, ...patch, updatedAt: Date.now() } : card,
      );
      persistCards(next);
      return { cards: next };
    });
  },

  deleteCard: (id) => {
    set((state) => {
      const next = state.cards.filter((card) => card.id !== id);
      persistCards(next);
      return { cards: next };
    });
  },

  moveCard: (id, targetColumnId, targetIndex) => {
    set((state) => {
      const target = state.cards.find((c) => c.id === id);
      if (!target) return state;

      const remaining = state.cards.filter((c) => c.id !== id);
      const targetColCards = remaining
        .filter((c) => c.columnId === targetColumnId)
        .sort((a, b) => a.order - b.order);

      const index =
        targetIndex !== undefined
          ? Math.max(0, Math.min(targetColCards.length, targetIndex))
          : targetColCards.length;

      const updatedTarget: KanbanCard = {
        ...target,
        columnId: targetColumnId,
        updatedAt: Date.now(),
      };

      targetColCards.splice(index, 0, updatedTarget);
      const reorderedColCards = targetColCards.map((c, i) => ({
        ...c,
        order: i,
      }));

      const otherCards = remaining.filter((c) => c.columnId !== targetColumnId);
      const next = [...otherCards, ...reorderedColCards];
      persistCards(next);
      return { cards: next };
    });
  },

  convertNoteToCard: (note, targetColumnId = "ideas", priority = "medium") => {
    const now = Date.now();
    const id = `card_${now}_${Math.random().toString(36).slice(2, 7)}`;
    let created: KanbanCard = {
      id,
      title: note.title.trim() || "Nota sin titulo",
      description: note.body,
      columnId: targetColumnId,
      priority,
      order: 0,
      createdAt: now,
      updatedAt: now,
      sourceNoteId: note.id,
      sourceCwd: note.sourceCwd,
    };

    set((state) => {
      const columnCards = state.cards.filter(
        (c) => c.columnId === targetColumnId,
      );
      created = { ...created, order: columnCards.length };
      const next = [...state.cards, created];
      persistCards(next);
      return { cards: next };
    });

    return created;
  },

  clearCompleted: () => {
    set((state) => {
      const next = state.cards.filter((card) => card.columnId !== "done");
      persistCards(next);
      return { cards: next };
    });
  },

  assignCardToAgent: (id, execution) => {
    set((state) => {
      const next = state.cards.map((card) => {
        if (card.id !== id) return card;
        return {
          ...card,
          columnId: "in_progress" as const,
          assignedExecution: execution,
          updatedAt: Date.now(),
        };
      });
      persistCards(next);
      return { cards: next };
    });
  },

  unassignCard: (id) => {
    set((state) => {
      const next = state.cards.map((card) => {
        if (card.id !== id) return card;
        const { assignedExecution: _, ...rest } = card;
        return {
          ...rest,
          updatedAt: Date.now(),
        };
      });
      persistCards(next);
      return { cards: next };
    });
  },

  updateCardExecutionStatus: (id, status) => {
    set((state) => {
      const next = state.cards.map((card) => {
        if (card.id !== id || !card.assignedExecution) return card;
        return {
          ...card,
          assignedExecution: {
            ...card.assignedExecution,
            lastObservedStatus: status,
          },
          updatedAt: Date.now(),
        };
      });
      persistCards(next);
      return { cards: next };
    });
  },

  resetCards: (cards) => {
    persistCards(cards);
    set({ cards });
  },
}));

/** Helper to extract task progress statistics from markdown body. */
export function extractTaskStats(markdown: string): {
  total: number;
  completed: number;
} {
  const checkboxRegex = /^\s*-\s*\[([ xX])\]/gm;
  let total = 0;
  let completed = 0;
  let match: RegExpExecArray | null = checkboxRegex.exec(markdown);

  while (match !== null) {
    total++;
    if (match[1].toLowerCase() === "x") {
      completed++;
    }
    match = checkboxRegex.exec(markdown);
  }

  return { total, completed };
}
