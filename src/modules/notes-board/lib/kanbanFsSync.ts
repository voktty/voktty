import {
  listDir,
  readTextFile,
  writeTextFile,
  type FsEntry,
} from "@/modules/harness/lib/fs";
import {
  parseMarkdownToCard,
  serializeCardToMarkdown,
  slugifyTitle,
} from "./kanbanMarkdown";
import type { KanbanCard, KanbanColumnId } from "./kanbanTypes";

const SUBDIRS: KanbanColumnId[] = ["ideas", "todo", "in_progress", "done"];

function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""))
    .join("/")
    .replace(/\/+/g, "/");
}

/**
 * Exports in-memory cards to the Git-friendly .voktty/tasks/ vault directory structure.
 */
export async function exportCardsToProjectVault(
  cwd: string,
  cards: KanbanCard[],
): Promise<{ count: number }> {
  let count = 0;
  const targetCards = cwd
    ? cards.filter((c) => !c.sourceCwd || c.sourceCwd === cwd)
    : cards;

  for (const card of targetCards) {
    const slug = slugifyTitle(card.title);
    const fileName = `${slug}.md`;
    const filePath = joinPath(cwd, ".voktty", "tasks", card.columnId, fileName);
    const content = serializeCardToMarkdown(card);

    try {
      await writeTextFile(filePath, content);
      count++;
    } catch (e) {
      console.warn("[voktty] failed to export card to vault:", filePath, e);
    }
  }

  return { count };
}

/**
 * Imports cards from the .voktty/tasks/ vault directory structure.
 */
export async function importCardsFromProjectVault(
  cwd: string,
): Promise<KanbanCard[]> {
  const importedCards: KanbanCard[] = [];

  for (const columnId of SUBDIRS) {
    const colDir = joinPath(cwd, ".voktty", "tasks", columnId);
    let entries: FsEntry[] = [];
    try {
      entries = await listDir(colDir);
    } catch {
      // Directory may not exist yet
      continue;
    }

    for (const entry of entries) {
      if (entry.isDir || !entry.name.endsWith(".md")) continue;

      try {
        const content = await readTextFile(entry.path);
        const card = parseMarkdownToCard(content, columnId, entry.name);
        card.sourceCwd = cwd;
        importedCards.push(card);
      } catch (e) {
        console.warn("[voktty] failed to read task card:", entry.path, e);
      }
    }
  }

  return importedCards;
}
