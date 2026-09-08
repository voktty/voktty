import { t } from "@/modules/i18n";
import type {
  KanbanCard,
  KanbanColumnId,
  KanbanPriority,
  AssignedExecution,
} from "./kanbanTypes";

/** Generates a safe file slug from a card title. */
export function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "tarea";
}

/** Serializes a KanbanCard into markdown format with YAML frontmatter. */
export function serializeCardToMarkdown(card: KanbanCard): string {
  const frontmatterLines: string[] = [
    "---",
    `id: "${card.id}"`,
    `title: "${card.title.replace(/"/g, '\\"')}"`,
    `column: "${card.columnId}"`,
  ];

  if (card.priority) {
    frontmatterLines.push(`priority: "${card.priority}"`);
  }

  frontmatterLines.push(`order: ${card.order}`);
  frontmatterLines.push(`createdAt: ${card.createdAt}`);
  frontmatterLines.push(`updatedAt: ${card.updatedAt}`);

  if (card.sourceNoteId) {
    frontmatterLines.push(`sourceNoteId: "${card.sourceNoteId}"`);
  }

  if (card.sourceCwd) {
    frontmatterLines.push(`sourceCwd: "${card.sourceCwd.replace(/"/g, '\\"')}"`);
  }

  if (card.tags && card.tags.length > 0) {
    frontmatterLines.push("tags:");
    for (const tag of card.tags) {
      frontmatterLines.push(`  - "${tag.replace(/"/g, '\\"')}"`);
    }
  }

  if (card.assignedExecution) {
    const ex = card.assignedExecution;
    frontmatterLines.push("assignedExecution:");
    frontmatterLines.push(`  leafId: ${ex.leafId}`);
    frontmatterLines.push(`  tabId: ${ex.tabId}`);
    frontmatterLines.push(`  agentName: "${ex.agentName}"`);
    frontmatterLines.push(`  startedAt: ${ex.startedAt}`);
    frontmatterLines.push(`  lastObservedStatus: "${ex.lastObservedStatus}"`);
    if (ex.finishedAt !== undefined) {
      frontmatterLines.push(`  finishedAt: ${ex.finishedAt}`);
    }
    if (ex.durationMs !== undefined) {
      frontmatterLines.push(`  durationMs: ${ex.durationMs}`);
    }
  }

  frontmatterLines.push("---");
  frontmatterLines.push("");

  const body = card.description.trim();
  return frontmatterLines.join("\n") + (body ? body + "\n" : "");
}

/** Parses a markdown string with frontmatter into a KanbanCard. */
export function parseMarkdownToCard(
  content: string,
  fallbackColumnId: KanbanColumnId = "ideas",
  filename?: string,
): KanbanCard {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = frontmatterRegex.exec(content);

  let id = "";
  let title = "";
  let columnId = fallbackColumnId;
  let priority: KanbanPriority | undefined;
  let order = 0;
  let createdAt = Date.now();
  let updatedAt = Date.now();
  let sourceNoteId: string | undefined;
  let sourceCwd: string | undefined;
  let tags: string[] | undefined;
  let assignedExecution: AssignedExecution | undefined;
  let description = "";

  if (match) {
    const rawYaml = match[1];
    description = match[2].trim();

    const lines = rawYaml.split(/\r?\n/);
    let inTags = false;
    let inAssignedExecution = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (trimmed === "tags:") {
        inTags = true;
        inAssignedExecution = false;
        tags = [];
        continue;
      }

      if (trimmed === "assignedExecution:") {
        inAssignedExecution = true;
        inTags = false;
        assignedExecution = {
          leafId: 0,
          tabId: 0,
          agentName: "agent",
          startedAt: Date.now(),
          lastObservedStatus: "idle",
        };
        continue;
      }

      if (inTags) {
        if (trimmed.startsWith("- ")) {
          const val = trimmed
            .slice(2)
            .trim()
            .replace(/^["']|["']$/g, "")
            .trim();
          if (val) tags?.push(val);
          continue;
        } else if (!line.startsWith(" ") && !line.startsWith("\t")) {
          inTags = false;
        }
      }

      if (inAssignedExecution) {
        if (line.startsWith("  ") || line.startsWith("\t")) {
          const colonIdx = trimmed.indexOf(":");
          if (colonIdx > 0 && assignedExecution) {
            const key = trimmed.slice(0, colonIdx).trim();
            const val = trimmed
              .slice(colonIdx + 1)
              .trim()
              .replace(/^["']|["']$/g, "")
              .trim();
            if (key === "leafId") assignedExecution.leafId = Number(val) || 0;
            if (key === "tabId") assignedExecution.tabId = Number(val) || 0;
            if (key === "agentName") assignedExecution.agentName = val;
            if (key === "startedAt") assignedExecution.startedAt = Number(val) || 0;
            if (key === "finishedAt") assignedExecution.finishedAt = Number(val) || undefined;
            if (key === "durationMs") assignedExecution.durationMs = Number(val) || undefined;
            if (key === "lastObservedStatus") {
              if (val === "working" || val === "waiting" || val === "idle" || val === "error") {
                assignedExecution.lastObservedStatus = val;
              }
            }
          }
          continue;
        } else {
          inAssignedExecution = false;
        }
      }

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed
          .slice(colonIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, "")
          .trim();

        if (key === "id") id = val;
        else if (key === "title") title = val;
        else if (key === "column") {
          if (val === "ideas" || val === "todo" || val === "in_progress" || val === "done") {
            columnId = val;
          }
        } else if (key === "priority") {
          if (val === "low" || val === "medium" || val === "high" || val === "urgent") {
            priority = val;
          }
        } else if (key === "order") order = Number(val) || 0;
        else if (key === "createdAt") createdAt = Number(val) || Date.now();
        else if (key === "updatedAt") updatedAt = Number(val) || Date.now();
        else if (key === "sourceNoteId") sourceNoteId = val;
        else if (key === "sourceCwd") sourceCwd = val;
      }
    }
  } else {
    description = content.trim();
  }

  if (!id) {
    if (filename) {
      id = filename.replace(/\.md$/i, "");
    } else {
      id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
  }

  if (!title) {
    if (filename) {
      title = filename
        .replace(/\.md$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    } else {
      title = t("notesBoard.untitledTask");
    }
  }

  return {
    id,
    title,
    description,
    columnId,
    priority,
    order,
    createdAt,
    updatedAt,
    sourceNoteId,
    sourceCwd,
    tags,
    assignedExecution,
  };
}
