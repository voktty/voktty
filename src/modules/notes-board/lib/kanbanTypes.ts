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
};

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: "ideas" },
  { id: "todo" },
  { id: "in_progress" },
  { id: "done" },
];

export const COLUMN_TITLE_KEYS: Record<KanbanColumnId, string> = {
  ideas: "notesBoard.columns.ideas",
  todo: "notesBoard.columns.todo",
  in_progress: "notesBoard.columns.inProgress",
  done: "notesBoard.columns.done",
};

export const PRIORITY_LABEL_KEYS: Record<KanbanPriority, string> = {
  low: "notesBoard.priority.low",
  medium: "notesBoard.priority.medium",
  high: "notesBoard.priority.high",
  urgent: "notesBoard.priority.urgent",
};
