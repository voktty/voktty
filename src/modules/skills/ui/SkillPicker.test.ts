import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SkillPicker } from "./SkillPicker";
import type { Skill } from "../model/skills";

describe("SkillPicker UI", () => {
  it("renders skills, invocations, and descriptions", () => {
    const skills: Skill[] = [
      {
        kind: "builtin",
        name: "create-skill",
        invocation: "create-skill",
        description: "Create a Voktty skill",
        scope: "builtin",
        source: "voktty",
      },
      {
        kind: "file",
        name: "review-pr",
        invocation: "review-pr",
        description: "Review pull requests against team standards.",
        path: "/repo/.agents/skills/review-pr/SKILL.md",
        scope: "project",
        source: "agents",
      },
      {
        kind: "native",
        name: "compact",
        invocation: "compact",
        description: "Summarize session history",
        source: "omp",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(SkillPicker, {
        skills,
        query: "",
        active: 0,
        creating: false,
        cwd: "/repo",
        onActive: vi.fn(),
        onPick: vi.fn(),
        onStartCreate: vi.fn(),
        onCancelCreate: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain("/create-skill");
    expect(html).toContain("/review-pr");
    expect(html).toContain("/compact");
    expect(html).toContain("Review pull requests against team standards.");
    expect(html).toContain("New skill");
  });

  it("renders create skill form when creating is true", () => {
    const html = renderToStaticMarkup(
      createElement(SkillPicker, {
        skills: [],
        query: "my-tool",
        active: 0,
        creating: true,
        cwd: "/repo",
        onActive: vi.fn(),
        onPick: vi.fn(),
        onStartCreate: vi.fn(),
        onCancelCreate: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain("Writes a starter SKILL.md you can edit.");
    expect(html).toContain("skill-name");
    expect(html).toContain("Project");
    expect(html).toContain("Personal");
  });
});
