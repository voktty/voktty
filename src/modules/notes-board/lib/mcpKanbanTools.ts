import { extractTaskStats, useKanbanStore } from "../store/kanbanStore";
import type {
  KanbanCard,
  KanbanColumnId,
  KanbanPriority,
} from "./kanbanTypes";

export type ListTasksArgs = {
  columnId?: KanbanColumnId;
  search?: string;
};

export type CreateTaskArgs = {
  title: string;
  description?: string;
  columnId?: KanbanColumnId;
  priority?: KanbanPriority;
};

export type UpdateTaskStatusArgs = {
  cardId: string;
  columnId?: KanbanColumnId;
  description?: string;
  priority?: KanbanPriority;
};

export const KANBAN_MCP_TOOL_DEFINITIONS = [
  {
    name: "voktty_list_tasks",
    description:
      "Lists tasks from the Voktty Kanban productivity board. Allows filtering by column (ideas, todo, in_progress, done) or searching by text.",
    inputSchema: {
      type: "object",
      properties: {
        columnId: {
          type: "string",
          enum: ["ideas", "todo", "in_progress", "done"],
          description: "Optional column to filter tasks by.",
        },
        search: {
          type: "string",
          description: "Optional search query to match title or description.",
        },
      },
    },
  },
  {
    name: "voktty_create_task",
    description:
      "Creates a new task card on the Voktty Kanban board. Useful for planning steps, capturing ideas, or tracking agent subtasks.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: {
          type: "string",
          description: "Title of the task.",
        },
        description: {
          type: "string",
          description:
            "Detailed task description or markdown checklist (- [ ] step).",
        },
        columnId: {
          type: "string",
          enum: ["ideas", "todo", "in_progress", "done"],
          description: "Target column (defaults to todo).",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Task priority (defaults to medium).",
        },
      },
    },
  },
  {
    name: "voktty_update_task_status",
    description:
      "Updates an existing Kanban task card: changes its column/status, updates checklist markdown, or updates priority.",
    inputSchema: {
      type: "object",
      required: ["cardId"],
      properties: {
        cardId: {
          type: "string",
          description: "ID of the card to update.",
        },
        columnId: {
          type: "string",
          enum: ["ideas", "todo", "in_progress", "done"],
          description: "New column to move the card to.",
        },
        description: {
          type: "string",
          description: "Updated description or updated checklist.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Updated priority.",
        },
      },
    },
  },
];

export function executeListTasks(args: ListTasksArgs = {}) {
  const store = useKanbanStore.getState();
  let cards = store.cards;

  if (args.columnId) {
    cards = cards.filter((c) => c.columnId === args.columnId);
  }

  if (args.search?.trim()) {
    const q = args.search.trim().toLowerCase();
    cards = cards.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }

  const formatted = cards.map((card) => {
    const stats = extractTaskStats(card.description);
    return {
      id: card.id,
      title: card.title,
      column: card.columnId,
      priority: card.priority ?? "medium",
      order: card.order,
      checklist:
        stats.total > 0
          ? { total: stats.total, completed: stats.completed }
          : null,
      assignedExecution: card.assignedExecution
        ? {
            agent: card.assignedExecution.agentName,
            status: card.assignedExecution.lastObservedStatus,
            durationMs: card.assignedExecution.durationMs,
          }
        : null,
    };
  });

  return {
    count: formatted.length,
    tasks: formatted,
  };
}

export function executeCreateTask(args: CreateTaskArgs): {
  success: boolean;
  card?: KanbanCard;
  error?: string;
} {
  if (!args.title || !args.title.trim()) {
    return { success: false, error: "Title is required" };
  }

  const store = useKanbanStore.getState();
  const card = store.addCard({
    title: args.title.trim(),
    description: (args.description || "").trim(),
    columnId: args.columnId ?? "todo",
    priority: args.priority ?? "medium",
  });

  return { success: true, card };
}

export function executeUpdateTaskStatus(args: UpdateTaskStatusArgs): {
  success: boolean;
  card?: KanbanCard;
  error?: string;
} {
  const store = useKanbanStore.getState();
  const existing = store.cards.find((c) => c.id === args.cardId);
  if (!existing) {
    return { success: false, error: `Card with id ${args.cardId} not found` };
  }

  if (args.columnId && args.columnId !== existing.columnId) {
    store.moveCard(args.cardId, args.columnId);
  }

  const patch: Partial<KanbanCard> = {};
  if (args.description !== undefined) {
    patch.description = args.description;
  }
  if (args.priority !== undefined) {
    patch.priority = args.priority;
  }

  if (Object.keys(patch).length > 0) {
    store.updateCard(args.cardId, patch);
  }

  const updated = useKanbanStore
    .getState()
    .cards.find((c) => c.id === args.cardId);

  return { success: true, card: updated };
}
