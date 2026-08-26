import { describe, expect, it } from "vitest";
import {
  buildCommitMessagePrompt,
  cleanCommitMessage,
  getCommitMessageSystemPrompt,
  isValidCommitMessage,
  truncateDiff,
  COMMIT_MESSAGE_LANGUAGE_NAMES,
  type SourceControlEntry,
} from "./useSourceControlPanel";

describe("useSourceControlPanel - Commit Message Generation", () => {
  const dummyEntries: SourceControlEntry[] = [
    {
      key: "src/app.ts:+",
      path: "src/app.ts",
      mode: "+",
      indexStatus: "M",
      worktreeStatus: " ",
      statusLabel: "Modified",
      statusCode: "M",
      originalPath: null,
      untracked: false,
    },
    {
      key: "Cargo.lock:+",
      path: "Cargo.lock",
      mode: "+",
      indexStatus: "M",
      worktreeStatus: " ",
      statusLabel: "Modified",
      statusCode: "M",
      originalPath: null,
      untracked: false,
    },
  ];

  describe("truncateDiff", () => {
    it("returns empty result on empty string", () => {
      expect(truncateDiff("")).toEqual({ text: "", truncated: false });
      expect(truncateDiff("   ")).toEqual({ text: "", truncated: false });
    });

    it("omits lockfiles and generated files from diff body", () => {
      const rawDiff = [
        "diff --git a/Cargo.lock b/Cargo.lock",
        "index 123..456 100644",
        "--- a/Cargo.lock",
        "+++ b/Cargo.lock",
        "@@ -1,5 +1,5 @@",
        "-version = 1",
        "+version = 2",
        "diff --git a/src/app.ts b/src/app.ts",
        "index abc..def 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -10,3 +10,4 @@",
        "+console.log('hello');",
      ].join("\n");

      const result = truncateDiff(rawDiff);
      expect(result.text).toContain("large or generated file omitted");
      expect(result.text).toContain("console.log('hello');");
    });
  });

  describe("cleanCommitMessage", () => {
    it("cleans code fences and surrounding quotes", () => {
      expect(
        cleanCommitMessage("```\nfeat(ui): add editor language support\n```"),
      ).toBe("feat(ui): add editor language support");

      expect(
        cleanCommitMessage('"fix(git): handle diff errors properly"'),
      ).toBe("fix(git): handle diff errors properly");

      expect(
        cleanCommitMessage("Commit message: feat: add new feature"),
      ).toBe("feat: add new feature");
    });

    it("auto-formats valid descriptions without prefix into conventional commit", () => {
      expect(cleanCommitMessage("feat add new feature")).toBe("feat: add new feature");
      expect(cleanCommitMessage("Actualizar traducciones del sistema")).toBe(
        "chore: Actualizar traducciones del sistema",
      );
    });
  });

  describe("isValidCommitMessage", () => {
    it("accepts standard conventional commit prefixes with or without scopes", () => {
      expect(isValidCommitMessage("feat: new feature")).toBe(true);
      expect(isValidCommitMessage("feat(git): add commit generator")).toBe(true);
      expect(isValidCommitMessage("fix(locale): corregir idioma de mensajes")).toBe(true);
      expect(isValidCommitMessage("chore!: breaking chore change")).toBe(true);
    });
  });

  describe("buildCommitMessagePrompt & getCommitMessageSystemPrompt", () => {
    it("builds English prompt by default", () => {
      const prompt = buildCommitMessagePrompt(dummyEntries, "diff text", false);
      const system = getCommitMessageSystemPrompt();

      expect(prompt).toContain("Write the commit subject in English.");
      expect(prompt).toContain("src/app.ts");
      expect(system).toContain("in English");
    });

    it("builds localized prompt when editor language is specified", () => {
      const langName = COMMIT_MESSAGE_LANGUAGE_NAMES["es"];
      const prompt = buildCommitMessagePrompt(
        dummyEntries,
        "diff text",
        false,
        langName,
      );
      const system = getCommitMessageSystemPrompt(langName);

      expect(prompt).toContain("Spanish (Español)");
      expect(prompt).toContain("feat: agregar soporte para nuevo protocolo");
      expect(system).toContain("Spanish (Español)");
    });
  });
});
