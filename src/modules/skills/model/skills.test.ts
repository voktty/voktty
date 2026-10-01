import { describe, expect, it } from "vitest";
import {
  BUILTIN_CREATE_SKILL,
  blankSkillMarkdown,
  injectSkillPrompt,
  isValidSkillName,
  isNativeCommandPrompt,
  mergeCatalog,
  rankSkills,
  replaceSlashToken,
  skillNamesInText,
  skillTextParts,
  slashTokenAt,
  slugSkillName,
  type Skill,
} from "./skills";

describe("native command composer behavior", () => {
  it("filters commands by alias and inserts their invocation with arguments intact", () => {
    const workflow: Skill = {
      kind: "native",
      name: "orchestrate",
      invocation: "orchestrate",
      description: "Choose agents",
      aliases: ["review"],
    };
    expect(rankSkills([workflow], "review")).toEqual([workflow]);
    const text = "/rev foo";
    expect(
      replaceSlashToken(
        text,
        slashTokenAt(text, 4, true)!,
        workflow.invocation,
      ),
    ).toBe("/orchestrate foo");
    expect(slashTokenAt("/Review_Code", 12, true)?.query).toBe("Review_Code");
    expect(slashTokenAt("/Review_Code", 12)).toBeNull();
  });

  it("only treats leading command tokens as native invocations", () => {
    expect(isNativeCommandPrompt("/workflow foo @README.md", "omp")).toBe(true);
    expect(isNativeCommandPrompt("/omp:plan investigate", "omp")).toBe(true);
    for (const text of [
      "Explain /workflow",
      "> /workflow",
      "/tmp/file.ts",
      "/tmp\\file.ts",
      "hello",
    ]) {
      expect(isNativeCommandPrompt(text, "omp")).toBe(false);
    }
    expect(isNativeCommandPrompt("/review foo", "claude")).toBe(false);
  });
});

const review: Skill = {
  kind: "file",
  name: "review-pr",
  description: "Review pull requests against team standards.",
  invocation: "review-pr",
  path: "/tmp/.agents/skills/review-pr/SKILL.md",
  scope: "project",
  source: "agents",
};

const native: Skill = {
  kind: "file",
  name: "cursor-only",
  description: "Cursor native helper",
  invocation: "cursor-only",
  path: "/tmp/.cursor/skills/cursor-only/SKILL.md",
  scope: "project",
  source: "cursor",
};

const piNative: Skill = {
  kind: "native",
  name: "architect",
  description: "Design before implementation.",
  invocation: "skill:architect",
};

const piFile: Skill = {
  kind: "file",
  name: "pi-file",
  description: "Pi file skill",
  invocation: "pi-file",
  path: "/tmp/.pi/skills/pi-file/SKILL.md",
  scope: "project",
  source: "pi",
};

describe("skills model", () => {
  it("extracts slash skill names from prompt text", () => {
    expect(skillNamesInText("Please /review-pr and /ship-it")).toEqual([
      "review-pr",
      "ship-it",
    ]);
    expect(skillNamesInText("See https://example.com/foo")).toEqual([]);
    expect(skillNamesInText("/a/b/c")).toEqual([]);
    expect(skillNamesInText("> /quoted-skill\nnormal")).toEqual([]);
    expect(skillNamesInText("Do /plugin:skill-one now")).toEqual([
      "plugin:skill-one",
    ]);
  });

  it("splits text into normal and skill token segments for highlighting", () => {
    const names = new Set(["review-pr", "plugin:skill-one"]);
    expect(
      skillTextParts("Please /review-pr and /unknown and /plugin:skill-one now", names),
    ).toEqual([
      { text: "Please ", skill: false },
      { text: "/review-pr", skill: true },
      { text: " and /unknown and ", skill: false },
      { text: "/plugin:skill-one", skill: true },
      { text: " now", skill: false },
    ]);
  });

  it("finds the active slash token under cursor", () => {
    expect(slashTokenAt("hello /rev", 10)).toEqual({
      start: 6,
      end: 10,
      query: "rev",
    });
    expect(slashTokenAt("hello /plug:sk", 14)).toEqual({
      start: 6,
      end: 14,
      query: "plug:sk",
    });
    expect(slashTokenAt("http://example.com/foo", 22)).toBeNull();
    expect(slashTokenAt("> /quote", 8)).toBeNull();
    expect(slashTokenAt("/UPPER", 6)).toBeNull();
  });

  it("replaces slash tokens cleanly", () => {
    const token = slashTokenAt("run /rev now", 8)!;
    expect(replaceSlashToken("run /rev now", token, "review-pr")).toBe(
      "run /review-pr now",
    );
  });

  it("ranks skills with agents and project roots ahead of user and other provider roots", () => {
    const userAgents: Skill = {
      ...review,
      name: "global-review",
      scope: "user" as const,
    };
    const ranked = rankSkills(
      [native, userAgents, review, piFile, BUILTIN_CREATE_SKILL, piNative],
      "",
    );
    expect(ranked.map((s) => s.name)).toEqual([
      "create-skill",
      "architect",
      "cursor-only",
      "pi-file",
      "review-pr",
      "global-review",
    ]);
  });

  it("ranks by fuzzy query match", () => {
    const ranked = rankSkills([review, native], "rev");
    expect(ranked[0]?.name).toBe("review-pr");
  });

  it("merges discovered skills with built-in create-skill in canonical order", () => {
    const catalog = mergeCatalog([
      {
        name: "review-pr",
        description: "Review",
        path: "/p/.agents/skills/review-pr/SKILL.md",
        scope: "project",
        source: "agents",
      },
      {
        name: "cursor-only",
        description: "Cursor",
        path: "/p/.cursor/skills/cursor-only/SKILL.md",
        scope: "project",
        source: "cursor",
      },
    ]);
    expect(catalog.map((s) => s.name)).toEqual([
      "review-pr",
      "create-skill",
      "cursor-only",
    ]);
  });

  it("injects skill instructions into turn prompt", () => {
    const injected = injectSkillPrompt("hello", [review], {
      "review-pr": "Always check tests.",
    });
    expect(injected).toContain("## /review-pr");
    expect(injected).toContain("Always check tests.");
    expect(injected).toContain("hello");
  });

  it("validates and formats skill names and templates", () => {
    expect(slugSkillName("My New Skill!")).toBe("my-new-skill");
    expect(isValidSkillName("my-new-skill")).toBe(true);
    expect(isValidSkillName("-bad-")).toBe(false);
    expect(blankSkillMarkdown("deploy-app")).toContain("name: deploy-app");
  });
});
