import { describe, expect, it } from "vitest";
import {
  composeToolTitle,
  extractSearchQuery,
  extractShellCommand,
  extractSkillName,
  extractToolPreview,
  isWeakToolTitle,
  titleFromToolInput,
} from "./preview";

describe("extractToolPreview", () => {
  it("reads nested args bags from ACP tool calls", () => {
    const preview = extractToolPreview(
      {
        kind: "read",
        title: "Read",
        rawInput: {
          args: { path: "src/chrome/TitleBar.tsx" },
        },
      },
      {},
    );
    expect(preview).toMatchObject({
      kind: "read",
      path: "src/chrome/TitleBar.tsx",
      fileName: "TitleBar.tsx",
    });
    expect(
      composeToolTitle({
        kind: "read",
        title: "Read",
        path: preview?.path,
        previewKind: preview?.kind,
      }),
    ).toBe("Read src/chrome/TitleBar.tsx");
  });

  it("accepts relative single-segment paths", () => {
    const preview = extractToolPreview(
      { kind: "read", title: "Read", rawInput: { path: "README.md" } },
      {},
    );
    expect(preview?.path).toBe("README.md");
  });

  it("does not treat file contents as a path", () => {
    const preview = extractToolPreview(
      {
        kind: "read",
        title: "Read",
        rawInput: { path: "/** Structured language…" },
      },
      {},
    );
    expect(preview?.path).toBeUndefined();
  });

  it("finds search queries in nested input", () => {
    expect(
      extractSearchQuery([
        { arguments: { pattern: "busyHarness|busy.*tab" } },
      ]),
    ).toBe("busyHarness|busy.*tab");
  });

  it("uses locations when rawInput is empty", () => {
    const preview = extractToolPreview(
      {
        kind: "read",
        title: "Read",
        locations: [{ path: "src/App.tsx" }],
      },
      {},
    );
    expect(preview?.path).toBe("src/App.tsx");
  });

  it("treats glob_pattern as a Find query", () => {
    const preview = extractToolPreview(
      {
        kind: "search",
        title: "Find",
        name: "Glob",
        rawInput: { glob_pattern: "**/*.{json,md}" },
      },
      {},
    );
    expect(preview).toMatchObject({
      kind: "search",
      query: "**/*.{json,md}",
    });
    expect(
      composeToolTitle({
        kind: "search",
        title: "Find",
        query: preview?.query,
        previewKind: preview?.kind,
      }),
    ).toBe("Find **/*.{json,md}");
  });
});

describe("shell command titles", () => {
  it("pulls the command out of nested input bags", () => {
    expect(extractShellCommand({ args: { command: "git status -s" } })).toBe(
      "git status -s",
    );
    expect(extractShellCommand({ cmd: "pwd" })).toBe("pwd");
    expect(extractShellCommand({ command: ["npm", "test"] })).toBe("npm test");
    expect(
      extractShellCommand({}, { rawInput: {} }, { input: { command: "git status" } }),
    ).toBe("git status");
  });

  it("labels execute tools with the command, not the tool name", () => {
    expect(
      composeToolTitle({
        kind: "execute",
        title: "Bash",
        command: "rm -rf /tmp/build",
      }),
    ).toBe("rm -rf /tmp/build");
    expect(titleFromToolInput("bash", "execute", { command: "ls -la" })).toBe(
      "ls -la",
    );
    expect(
      titleFromToolInput("Bash", "execute", {
        description: "List files",
        command: "ls -la",
      }),
    ).toBe("ls -la");
  });

  it("does not substitute Claude's description for the command", () => {
    expect(
      titleFromToolInput("Bash", "execute", { description: "List files" }),
    ).toBe("Shell");
    expect(titleFromToolInput("bash", "execute", {})).toBe("Shell");
  });

  it("treats Bash/bash as a weak placeholder so a later command can replace it", () => {
    expect(isWeakToolTitle("Bash")).toBe(true);
    expect(isWeakToolTitle("bash")).toBe(true);
    expect(isWeakToolTitle("ls")).toBe(false);
  });
});

describe("skill titles", () => {
  it("labels a Skill tool with /name", () => {
    expect(extractSkillName({ skill: "code-review" })).toBe("code-review");
    expect(extractSkillName({ args: { skill_name: "commit" } })).toBe("commit");
    expect(extractSkillName({}, { rawInput: {} }, { skill: "code-review" })).toBe(
      "code-review",
    );
    expect(titleFromToolInput("Skill", "skill", { skill: "code-review" })).toBe(
      "Skill /code-review",
    );
    expect(
      composeToolTitle({
        kind: "skill",
        title: "Skill",
        skill: "code-review",
      }),
    ).toBe("Skill /code-review");
  });

  it("does not treat a bare Skill placeholder as the name", () => {
    expect(titleFromToolInput("Skill", "skill", {})).toBe("Skill");
    expect(isWeakToolTitle("Skill")).toBe(true);
    expect(isWeakToolTitle("Skill /code-review")).toBe(false);
  });
});
