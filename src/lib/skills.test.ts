import { describe, expect, it } from "vitest";
import {
  BUILTIN_CREATE_SKILL,
  blankSkillMarkdown,
  injectSkillPrompt,
  isValidSkillName,
  mergeCatalog,
  rankSkills,
  replaceSlashToken,
  skillNamesInText,
  skillTextParts,
  slashTokenAt,
  slugSkillName,
  type Skill,
} from "./skills";

const review: Skill = {
  name: "review-pr",
  description: "Review pull requests against team standards.",
  path: "/tmp/.agents/skills/review-pr/SKILL.md",
  scope: "project",
  source: "agents",
};

const native: Skill = {
  name: "cursor-only",
  description: "Cursor native helper",
  path: "/tmp/.cursor/skills/cursor-only/SKILL.md",
  scope: "project",
  source: "cursor",
};

describe("slashTokenAt", () => {
  it("reads the /token the cursor is in", () => {
    expect(slashTokenAt("/cre", 4)).toEqual({
      start: 0,
      end: 4,
      query: "cre",
    });
    expect(slashTokenAt("please /rev", 11)).toEqual({
      start: 7,
      end: 11,
      query: "rev",
    });
  });

  it("ignores URLs and paths", () => {
    expect(slashTokenAt("https://example.com", 12)).toBeNull();
    expect(slashTokenAt("/Users/me", 4)).toBeNull();
    expect(slashTokenAt("foo/bar", 4)).toBeNull();
  });

  it("closes after a space", () => {
    expect(slashTokenAt("/review-pr now", 14)).toBeNull();
  });
});

describe("replaceSlashToken", () => {
  it("inserts /name and a trailing space", () => {
    expect(replaceSlashToken("/cre", { start: 0, end: 4, query: "cre" }, "create-skill")).toBe(
      "/create-skill ",
    );
    expect(
      replaceSlashToken("x /r y", { start: 2, end: 4, query: "r" }, "review-pr"),
    ).toBe("x /review-pr y");
  });
});

describe("skillNamesInText", () => {
  it("collects unique /skill tokens", () => {
    expect(skillNamesInText("/create-skill write a deploy skill")).toEqual([
      "create-skill",
    ]);
    expect(skillNamesInText("/review-pr /create-skill /review-pr")).toEqual([
      "review-pr",
      "create-skill",
    ]);
    expect(skillNamesInText("path /tmp/foo")).toEqual([]);
  });
});

describe("skillTextParts", () => {
  const names = new Set(["review-pr", "create-skill"]);

  it("marks known /skill tokens", () => {
    expect(skillTextParts("/review-pr look at auth", names)).toEqual([
      { text: "/review-pr", skill: true },
      { text: " look at auth", skill: false },
    ]);
  });

  it("leaves unknown /tokens as plain text", () => {
    expect(skillTextParts("see /not-a-skill please", names)).toEqual([
      { text: "see /not-a-skill please", skill: false },
    ]);
  });

  it("splits multiple skills", () => {
    expect(skillTextParts("/review-pr then /create-skill", names)).toEqual([
      { text: "/review-pr", skill: true },
      { text: " then ", skill: false },
      { text: "/create-skill", skill: true },
    ]);
  });
});

describe("injectSkillPrompt", () => {
  it("prefixes invoked skill bodies and keeps the user text", () => {
    const out = injectSkillPrompt(
      "/review-pr look at auth",
      [review],
      { "review-pr": "# Review\n\nBe strict." },
    );
    expect(out).toContain("## /review-pr");
    expect(out).toContain("Be strict.");
    expect(out.endsWith("/review-pr look at auth")).toBe(true);
  });

  it("returns the original text when nothing matches", () => {
    expect(injectSkillPrompt("hello", [], {})).toBe("hello");
  });
});

describe("mergeCatalog", () => {
  it("lets .agents win, then MonoCode create-skill, then provider skills", () => {
    const catalog = mergeCatalog([
      {
        name: "review-pr",
        description: "from agents",
        path: "/p/.agents/skills/review-pr/SKILL.md",
        scope: "project",
        source: "agents",
      },
      {
        name: "review-pr",
        description: "from claude",
        path: "/p/.claude/skills/review-pr/SKILL.md",
        scope: "project",
        source: "claude",
      },
      {
        name: "create-skill",
        description: "claude native",
        path: "/home/.claude/skills/create-skill/SKILL.md",
        scope: "user",
        source: "claude",
      },
      {
        name: "cursor-only",
        description: "native",
        path: "/p/.cursor/skills/cursor-only/SKILL.md",
        scope: "project",
        source: "cursor",
      },
    ]);
    expect(catalog.find((s) => s.name === "review-pr")?.description).toBe(
      "from agents",
    );
    expect(catalog.find((s) => s.name === "create-skill")).toEqual(
      BUILTIN_CREATE_SKILL,
    );
    expect(catalog.find((s) => s.name === "cursor-only")?.source).toBe("cursor");
  });
});

describe("rankSkills", () => {
  it("puts create-skill first when the query is empty", () => {
    const ranked = rankSkills([native, review, BUILTIN_CREATE_SKILL], "");
    expect(ranked.map((s) => s.name)).toEqual([
      "create-skill",
      "cursor-only",
      "review-pr",
    ]);
  });

  it("fuzzy-matches names ahead of descriptions", () => {
    const ranked = rankSkills([native, review, BUILTIN_CREATE_SKILL], "rev");
    expect(ranked[0]?.name).toBe("review-pr");
  });
});

describe("skill names", () => {
  it("slugs and validates", () => {
    expect(slugSkillName("Review PR")).toBe("review-pr");
    expect(isValidSkillName("review-pr")).toBe(true);
    expect(isValidSkillName("Review")).toBe(false);
    expect(isValidSkillName("-nope")).toBe(false);
  });

  it("writes a starter SKILL.md", () => {
    const md = blankSkillMarkdown("review-pr");
    expect(md).toContain("name: review-pr");
    expect(md).toContain("# Review Pr");
  });
});
