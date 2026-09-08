export type KanbanColumnId = "ideas" | "todo" | "in_progress" | "done";

export type KanbanPriority = "low" | "medium" | "high" | "urgent";

export type AgentExecutionStatus = "working" | "waiting" | "idle" | "error";

export type AssignedExecution = {
  leafId: number;
  tabId: number;
  agentName: string;
  startedAt: number;
  lastObservedStatus: AgentExecutionStatus;
  finishedAt?: number;
  durationMs?: number;
  requiresAttention?: boolean;
  errorReason?: string;
};

export type KanbanCard = {
  id: string;
  title: string;
  description: string;
  columnId: KanbanColumnId;
  priority?: KanbanPriority;
  order: number;
  createdAt: number;
  updatedAt: number;
  sourceNoteId?: string;
  sourceCwd?: string;
  tags?: string[];
  assignedExecution?: AssignedExecution;
};

export type KanbanColumn = {
  id: KanbanColumnId;
  title: string;
  description: string;
};

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  {
    id: "ideas",
    title: "Ideas",
    description: "Borradores, conceptos y notas rapidas",
  },
  {
    id: "todo",
    title: "Por Hacer",
    description: "Tareas planificadas y pendientes",
  },
  {
    id: "in_progress",
    title: "En Progreso",
    description: "Tareas en desarrollo o ejecutadas por agente",
  },
  {
    id: "done",
    title: "Completado",
    description: "Tareas finalizadas y verificadas",
  },
];
