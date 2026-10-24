import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import {
  requireVaultCurrent,
  vaultFilesystem,
  vaultPath,
} from "./vaultFilesystem";
import {
  parseMarkdownToCard,
  serializeCardToMarkdown,
  slugifyTitle,
} from "./kanbanMarkdown";
import type { KanbanCard, KanbanColumnId } from "./kanbanTypes";

const SUBDIRS: KanbanColumnId[] = ["ideas", "todo", "in_progress", "done"];

type VaultOptions = { workspace?: WorkspaceEnv; current?: () => boolean };
const MAX_CARDS = 256;
const MAX_CARD_CHARS = 1024 * 1024;
const MAX_TOTAL_CHARS = 8 * MAX_CARD_CHARS;

/**
 * Exports in-memory cards to the Git-friendly .voktty/tasks/ vault directory structure.
 */
export async function exportCardsToProjectVault(
  cwd: string,
  cards: KanbanCard[],
  options: VaultOptions = {},
): Promise<{ count: number }> {
  const current = options.current ?? (() => true);
  const fs = vaultFilesystem(
    cwd,
    options.workspace ?? LOCAL_WORKSPACE,
    current,
  );
  let count = 0;
  const targetCards = cards.filter((c) => !c.sourceCwd || c.sourceCwd === cwd);
  if (targetCards.length > MAX_CARDS) throw new Error("Too many vault cards");
  let total = 0;
  const destinations = new Set<string>();
  const writes = targetCards.map((card) => {
    if (!SUBDIRS.includes(card.columnId))
      throw new Error("Invalid vault column");
    const name = `${slugifyTitle(card.title)}.md`;
    if (name.length > 255) throw new Error("Vault filename is too long");
    const key = `${card.columnId}/${name}`;
    if (destinations.has(key)) throw new Error("Duplicate vault filename");
    destinations.add(key);
    const content = serializeCardToMarkdown(card);
    total += content.length;
    if (content.length > MAX_CARD_CHARS || total > MAX_TOTAL_CHARS)
      throw new Error("Vault export is too large");
    return { column: card.columnId, name, content };
  });

  for (const { column, name, content } of writes) {
    requireVaultCurrent(current);
    await fs.write(column, name, content);
    count++;
  }
  requireVaultCurrent(current);
  return { count };
}

/**
 * Imports cards from the .voktty/tasks/ vault directory structure.
 */
export async function importCardsFromProjectVault(
  cwd: string,
  options: VaultOptions = {},
): Promise<KanbanCard[]> {
  const current = options.current ?? (() => true);
  const fs = vaultFilesystem(
    cwd,
    options.workspace ?? LOCAL_WORKSPACE,
    current,
  );
  const importedCards: KanbanCard[] = [];
  let total = 0;

  for (const columnId of SUBDIRS) {
    requireVaultCurrent(current);
    const colDir = vaultPath(cwd, ".voktty", "tasks", columnId);
    let entries: { name: string; isDir: boolean }[] = [];
    try {
      entries = await fs.list(colDir);
    } catch (error) {
      requireVaultCurrent(current);
      if (
        /ENOENT|no such file or directory|\(os error [23]\)/i.test(
          String(error),
        )
      )
        continue;
      throw error;
    }

    for (const entry of entries) {
      if (entry.isDir || !entry.name.endsWith(".md")) continue;
      requireVaultCurrent(current);
      if (/[\\/\x00-\x1f\x7f]/.test(entry.name) || entry.name.length > 255)
        throw new Error("Invalid vault filename");
      if (importedCards.length >= MAX_CARDS)
        throw new Error("Too many vault cards");
      const content = await fs.read(vaultPath(colDir, entry.name));
      requireVaultCurrent(current);
      total += content.length;
      if (content.length > MAX_CARD_CHARS || total > MAX_TOTAL_CHARS)
        throw new Error("Vault import is too large");
      const card = parseMarkdownToCard(content, columnId, entry.name);
      card.sourceCwd = cwd;
      importedCards.push(card);
    }
  }

  requireVaultCurrent(current);
  return importedCards;
}
