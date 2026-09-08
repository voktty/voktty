import { describe, expect, it } from "vitest";
import {
  parseMarkdownToCard,
  serializeCardToMarkdown,
  slugifyTitle,
} from "./kanbanMarkdown";
import type { KanbanCard } from "./kanbanTypes";

describe("kanbanMarkdown", () => {
  describe("slugifyTitle", () => {
    it("converts titles to safe URL/filesystem slugs", () => {
      expect(slugifyTitle("Refactorizar Modulo de Autenticacion")).toBe(
        "refactorizar-modulo-de-autenticacion",
      );
      expect(slugifyTitle("Tarea #123: ¡Atencion urgente!")).toBe(
        "tarea-123-atencion-urgente",
      );
      expect(slugifyTitle("   ")).toBe("tarea");
    });
  });

  describe("serializeCardToMarkdown and parseMarkdownToCard", () => {
    it("serializes a card to markdown with YAML frontmatter and parses it back", () => {
      const card: KanbanCard = {
        id: "card-abc-123",
        title: "Implementar endpoints REST",
        description: "Detalles de la tarea.\n\n- [ ] Endpoint 1\n- [x] Endpoint 2",
        columnId: "in_progress",
        priority: "high",
        order: 2,
        createdAt: 1700000000000,
        updatedAt: 1700000500000,
        sourceNoteId: "note-1",
        sourceCwd: "/workspace/voktty",
        tags: ["backend", "api"],
        assignedExecution: {
          leafId: 5,
          tabId: 2,
          agentName: "Claude Code",
          startedAt: 1700000050000,
          lastObservedStatus: "working",
        },
      };

      const md = serializeCardToMarkdown(card);
      expect(md).toContain('id: "card-abc-123"');
      expect(md).toContain('title: "Implementar endpoints REST"');
      expect(md).toContain('column: "in_progress"');
      expect(md).toContain('priority: "high"');
      expect(md).toContain("tags:");
      expect(md).toContain('  - "backend"');
      expect(md).toContain("assignedExecution:");
      expect(md).toContain("  agentName: \"Claude Code\"");
      expect(md).toContain("- [ ] Endpoint 1");

      const parsed = parseMarkdownToCard(md, "ideas", "card-abc-123.md");
      expect(parsed.id).toBe("card-abc-123");
      expect(parsed.title).toBe("Implementar endpoints REST");
      expect(parsed.columnId).toBe("in_progress");
      expect(parsed.priority).toBe("high");
      expect(parsed.order).toBe(2);
      expect(parsed.tags).toEqual(["backend", "api"]);
      expect(parsed.assignedExecution?.agentName).toBe("Claude Code");
      expect(parsed.assignedExecution?.lastObservedStatus).toBe("working");
      expect(parsed.description).toContain("- [ ] Endpoint 1");
    });

    it("handles plain markdown without frontmatter gracefully", () => {
      const plain = "# Tarea sin frontmatter\n\nCuerpo normal";
      const parsed = parseMarkdownToCard(plain, "todo", "mi-tarea-suelta.md");

      expect(parsed.id).toBe("mi-tarea-suelta");
      expect(parsed.title).toBe("Mi Tarea Suelta");
      expect(parsed.columnId).toBe("todo");
      expect(parsed.description).toBe(plain);
    });
  });
});
