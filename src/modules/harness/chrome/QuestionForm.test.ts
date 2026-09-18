import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import type { UserQuestionPrompt } from "../lib/userQuestion";

function prompt(multiSelect = false): UserQuestionPrompt {
  return {
    requestId: 7,
    questions: [
      {
        id: "colour",
        prompt: "Pick a colour",
        multiSelect,
        allowCustom: false,
        options: [
          { id: "red", label: "Red" },
          { id: "green", label: "Green" },
          { id: "blue", label: "Blue" },
        ],
      },
    ],
  };
}

describe("QuestionForm keyboard navigation and rendering", () => {
  it("renders single-select options with correct accessibility and shortcut attributes", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionForm, {
        prompt: prompt(false),
        onReply: vi.fn(),
      }),
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-keyshortcuts="1"');
    expect(html).toContain('aria-keyshortcuts="2"');
    expect(html).toContain('aria-keyshortcuts="3"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-highlighted="true"');
  });

  it("renders multi-select question with hints and options", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionForm, {
        prompt: prompt(true),
        onReply: vi.fn(),
      }),
    );

    expect(html).toContain("Pick a colour");
    expect(html).toContain("Red");
    expect(html).toContain("Green");
    expect(html).toContain("Blue");
    expect(html).toContain('aria-keyshortcuts="1"');
  });
});
