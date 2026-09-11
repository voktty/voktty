import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "../lib/session";
import {
  AgentTranscript,
  APPROVAL_ALLOW_CLASS,
  APPROVAL_DENY_CLASS,
  COMMAND_SUMMARY_SURFACE_CLASS,
  USER_MESSAGE_SURFACE_CLASS,
} from "./AgentTranscript";

function tool(id: string, approval?: Block["approval"]): Block {
  return {
    id,
    role: "tool",
    text: `Inspect hidden-detail-${id}`,
    tool: { kind: "shell", status: approval ? "pending" : "completed" },
    ...(approval ? { approval } : {}),
  };
}

function render(
  blocks: Block[],
  busy = false,
  latestTurnAccessory?: ReactNode,
) {
  return renderToStaticMarkup(
    createElement(AgentTranscript, { blocks, busy, latestTurnAccessory }),
  );
}

describe("AgentTranscript collapsed work", () => {
  it("renders the summary and answer without mounting a large completed tool trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Check the project" },
      ...Array.from({ length: 1357 }, (_, index) => tool(String(index))),
      { id: "answer", role: "assistant", text: "The project checks passed." },
    ];
    const markup = render(blocks);
    expect(markup).toContain("The project checks passed.");
    expect(markup).toContain("Show the work");
    expect(markup.includes("hidden-detail-")).toBe(false);
    const short = render([blocks[0], tool("one"), tool("two"), blocks[blocks.length - 1]!]);
    const tagCount = (html: string) => html.match(/<[a-z]/g)?.length ?? 0;
    expect(tagCount(markup)).toBe(tagCount(short));
  });

  it("keeps live work visible before the assistant answers", () => {
    expect(render([tool("live")], true)).toContain("hidden-detail-live");
  });

  it("keeps an unresolved approval visible even when narration follows it", () => {
    const markup = render(
      [
        tool("approval", { requestId: 1 }),
        {
          id: "answer",
          role: "assistant",
          text: "Please approve the command.",
        },
      ],
      true,
    );
    expect(markup).toContain("hidden-detail-approval");
    expect(markup).toContain("Please approve the command.");
    expect(markup.includes('aria-label="Show the work"')).toBe(false);
  });

  it("places a session accessory after the latest reply and before its action row", () => {
    const markup = render(
      [
        {
          id: "user",
          role: "user",
          text: "Change the files",
          startedAt: 1_000,
          durationMs: 500,
        },
        { id: "answer", role: "assistant", text: "Done changing files." },
      ],
      false,
      createElement("aside", { "data-test-review": true }, "Changed files"),
    );

    expect(markup.indexOf("Done changing files.")).toBeLessThan(
      markup.indexOf("Changed files"),
    );
    expect(markup.indexOf("Changed files")).toBeLessThan(
      markup.indexOf('aria-label="Worked for 1s"'),
    );
  });
});

describe("AgentTranscript theme contract", () => {
  const STRUCTURAL_CLASSES = [
    USER_MESSAGE_SURFACE_CLASS,
    COMMAND_SUMMARY_SURFACE_CLASS,
    APPROVAL_ALLOW_CLASS,
    APPROVAL_DENY_CLASS,
  ];

  it("uses Voktty semantic tokens for transcript surfaces and actions", () => {
    expect(USER_MESSAGE_SURFACE_CLASS).toContain("--surface-card");
    expect(COMMAND_SUMMARY_SURFACE_CLASS).toContain("--surface-active-item");
    expect(APPROVAL_ALLOW_CLASS).toContain("bg-primary");
    expect(APPROVAL_DENY_CLASS).toContain("--surface-active-item");

    for (const classes of STRUCTURAL_CLASSES) {
      expect(classes).not.toMatch(
        /(?:bg|border|text|shadow)-(?:zinc|white|black)|#[0-9a-f]{3,8}/i,
      );
    }
  });
});
