// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import type { UserQuestionPrompt } from "../lib/userQuestion";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

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

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

async function clickButton(text: string) {
  await act(async () => {
    buttonWithText(text).click();
    await Promise.resolve();
  });
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

  it("returns to an earlier answer and submits its updated value", async () => {
    const onReply = vi.fn();
    const singleQuestionPrompt = prompt(false);
    const twoQuestionPrompt: UserQuestionPrompt = {
      ...singleQuestionPrompt,
      questions: [
        singleQuestionPrompt.questions[0],
        {
          id: "size",
          prompt: "Pick a size",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        createElement(QuestionForm, {
          prompt: twoQuestionPrompt,
          onReply,
        }),
      );
    });

    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Back",
      ),
    ).toBe(false);

    await clickButton("Red");
    await clickButton("Continue");
    expect(container.textContent).toContain("Pick a size");

    await clickButton("Back");
    expect(container.textContent).toContain("Pick a colour");
    expect(buttonWithText("Red").getAttribute("aria-pressed")).toBe("true");

    await clickButton("Green");
    await clickButton("Continue");
    await clickButton("Large");
    await clickButton("Continue");

    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["green"], size: ["large"] },
    });
  });
});
