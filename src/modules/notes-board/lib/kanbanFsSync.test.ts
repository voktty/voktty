import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportCardsToProjectVault,
  importCardsFromProjectVault,
} from "./kanbanFsSync";
import type { KanbanCard } from "./kanbanTypes";

const mockFiles: Record<string, string> = {};
const mockDirs: Record<string, Array<{ name: string; path: string; isDir: boolean; ignored: boolean }>> = {};

vi.mock("@/modules/harness/lib/fs", () => ({
  writeTextFile: vi.fn(async (path: string, content: string) => {
    mockFiles[path] = content;
  }),
  readTextFile: vi.fn(async (path: string) => {
    if (mockFiles[path] !== undefined) return mockFiles[path];
    throw new Error(`File not found: ${path}`);
  }),
  listDir: vi.fn(async (path: string) => {
    return mockDirs[path] ?? [];
  }),
}));

describe("kanbanFsSync", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFiles)) delete mockFiles[key];
    for (const key of Object.keys(mockDirs)) delete mockDirs[key];
    vi.clearAllMocks();
  });

  it("exports cards into the .voktty/tasks vault structure", async () => {
    const cards: KanbanCard[] = [
      {
        id: "card-1",
        title: "Crear migrador de base de datos",
        description: "- [ ] Migrar SQLite\n- [ ] Verificar esquema",
        columnId: "todo",
        priority: "high",
        order: 0,
        createdAt: 1000,
        updatedAt: 1000,
        sourceCwd: "/workspace/voktty",
      },
    ];

    const res = await exportCardsToProjectVault("/workspace/voktty", cards);
    expect(res.count).toBe(1);

    const expectedPath = "/workspace/voktty/.voktty/tasks/todo/crear-migrador-de-base-de-datos.md";
    expect(mockFiles[expectedPath]).toBeDefined();
    expect(mockFiles[expectedPath]).toContain('title: "Crear migrador de base de datos"');
    expect(mockFiles[expectedPath]).toContain('priority: "high"');
  });

  it("imports cards from the .voktty/tasks directory structure", async () => {
    const colDir = "/workspace/voktty/.voktty/tasks/ideas";
    const filePath = `${colDir}/nueva-idea.md`;

    mockDirs[colDir] = [
      {
        name: "nueva-idea.md",
        path: filePath,
        isDir: false,
        ignored: false,
      },
    ];

    mockFiles[filePath] = `---
id: "card-vault-1"
title: "Nueva idea desde Git"
column: "ideas"
priority: "low"
order: 0
createdAt: 1000
updatedAt: 1000
---

Detalles de la idea importada.
`;

    const imported = await importCardsFromProjectVault("/workspace/voktty");
    expect(imported).toHaveLength(1);
    expect(imported[0].id).toBe("card-vault-1");
    expect(imported[0].title).toBe("Nueva idea desde Git");
    expect(imported[0].columnId).toBe("ideas");
    expect(imported[0].priority).toBe("low");
    expect(imported[0].description).toBe("Detalles de la idea importada.");
    expect(imported[0].sourceCwd).toBe("/workspace/voktty");
  });
});
