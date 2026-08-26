import { describe, expect, it } from "vitest";
import {
  buildSemanticStagingPrompt,
  parseSemanticGroups,
} from "./semanticStaging";

describe("semanticStaging", () => {
  it("builds prompt with files and diff snippet", () => {
    const prompt = buildSemanticStagingPrompt(
      [
        { path: "src/App.tsx", statusCode: "M", statusLabel: "Modified" },
        { path: "src/main.ts", statusCode: "A", statusLabel: "Added" },
      ],
      "diff --git a/src/App.tsx b/src/App.tsx",
    );
    expect(prompt).toContain("src/App.tsx");
    expect(prompt).toContain("src/main.ts");
    expect(prompt).toContain("diff --git");
  });

  it("parses valid JSON response into semantic groups", () => {
    const json = JSON.stringify([
      {
        type: "feat",
        scope: "terminal",
        message: "feat(terminal): add ghost autosuggestions",
        files: ["src/modules/terminal/ShellInput.tsx"],
        reason: "Terminal inline suggestions",
      },
      {
        type: "fix",
        scope: "git",
        message: "fix(git): resolve stage issue",
        files: ["src/modules/source-control/useSourceControl.ts"],
        reason: "Fix stage bug",
      },
    ]);

    const result = parseSemanticGroups(json, [
      "src/modules/terminal/ShellInput.tsx",
      "src/modules/source-control/useSourceControl.ts",
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("feat");
    expect(result[0].scope).toBe("terminal");
    expect(result[0].files).toEqual(["src/modules/terminal/ShellInput.tsx"]);
    expect(result[1].type).toBe("fix");
  });

  it("handles markdown code fences and cleans output", () => {
    const raw = `Here is the grouping:
\`\`\`json
[
  {
    "type": "chore",
    "scope": "deps",
    "message": "chore(deps): update dependencies",
    "files": ["package.json"]
  }
]
\`\`\``;

    const result = parseSemanticGroups(raw, ["package.json"]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("chore");
    expect(result[0].files).toEqual(["package.json"]);
  });

  it("gracefully handles invalid JSON", () => {
    expect(parseSemanticGroups("invalid text", ["a.ts"])).toEqual([]);
    expect(parseSemanticGroups("{}", ["a.ts"])).toEqual([]);
  });
});
