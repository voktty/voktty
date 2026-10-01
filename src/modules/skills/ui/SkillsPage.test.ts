import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SkillsPage } from "./SkillsPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "list_skills") {
      return [
        {
          name: "review-pr",
          description: "Review pull requests against team standards.",
          path: "C:/repo/.agents/skills/review-pr/SKILL.md",
          scope: "project",
          source: "agents",
        },
      ];
    }
    return undefined;
  }),
}));

describe("SkillsPage UI", () => {
  it("renders header, controls, and initial shell", () => {
    const html = renderToStaticMarkup(
      createElement(SkillsPage, {
        cwd: "C:/repo",
      }),
    );

    expect(html).toContain("Skills");
    expect(html).toContain("Refresh");
    expect(html).toContain("New Skill");
    expect(html).toContain("Filter skills by name, description, or source…");
  });
});
