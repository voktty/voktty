import { beforeEach, describe, expect, it } from "vitest";
import { useKanbanStore } from "../store/kanbanStore";
import {
  executeCreateTask,
  executeListTasks,
  executeUpdateTaskStatus,
  KANBAN_MCP_TOOL_DEFINITIONS,
} from "./mcpKanbanTools";

describe("mcpKanbanTools", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    useKanbanStore.getState().resetCards([]);
  });

  it("exposes valid tool schemas for MCP clients", () => {
    expect(KANBAN_MCP_TOOL_DEFINITIONS).toHaveLength(3);
    const names = KANBAN_MCP_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("voktty_list_tasks");
    expect(names).toContain("voktty_create_task");
    expect(names).toContain("voktty_update_task_status");
  });

  it("creates a task via executeCreateTask", () => {
    const res = executeCreateTask({
      title: "Nueva tarea desde IA",
      description: "- [ ] Paso 1\n- [ ] Paso 2",
      columnId: "todo",
      priority: "high",
    });

    expect(res.success).toBe(true);
    expect(res.card?.id).toBeDefined();
    expect(res.card?.title).toBe("Nueva tarea desde IA");
    expect(res.card?.columnId).toBe("todo");
    expect(res.card?.priority).toBe("high");
    expect(useKanbanStore.getState().cards).toHaveLength(1);
  });

  it("lists and filters tasks via executeListTasks", () => {
    executeCreateTask({
      title: "Tarea 1",
      description: "Desc",
      columnId: "ideas",
    });
    executeCreateTask({
      title: "Tarea 2",
      description: "- [x] Hecho",
      columnId: "todo",
    });

    const all = executeListTasks();
    expect(all.count).toBe(2);

    const filtered = executeListTasks({ columnId: "todo" });
    expect(filtered.count).toBe(1);
    expect(filtered.tasks[0].title).toBe("Tarea 2");
    expect(filtered.tasks[0].checklist).toEqual({ total: 1, completed: 1 });

    const searched = executeListTasks({ search: "Tarea 1" });
    expect(searched.count).toBe(1);
    expect(searched.tasks[0].title).toBe("Tarea 1");
  });

  it("updates a task status and description via executeUpdateTaskStatus", () => {
    const created = executeCreateTask({
      title: "Tarea a actualizar",
      description: "- [ ] En progreso",
      columnId: "todo",
    });

    const updateRes = executeUpdateTaskStatus({
      cardId: created.card!.id,
      columnId: "in_progress",
      description: "- [x] En progreso",
      priority: "urgent",
    });

    expect(updateRes.success).toBe(true);
    expect(updateRes.card?.columnId).toBe("in_progress");
    expect(updateRes.card?.priority).toBe("urgent");
    expect(updateRes.card?.description).toBe("- [x] En progreso");
  });

  it("handles non-existent card gracefully in executeUpdateTaskStatus", () => {
    const res = executeUpdateTaskStatus({
      cardId: "non-existent-card",
      columnId: "done",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("not found");
  });
});
