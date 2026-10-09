import { describe, expect, it } from "vitest";
import { CUSTOM_OPTION_ID } from "@/modules/harness/lib/userQuestion";
import {
  codexAsyncQuestions,
  codexAsyncQuestionResponse,
} from "./codexQuestions";

describe("Codex async question messages", () => {
  it("converts suggested choices and free-text questions with distinct IDs", () => {
    const questions = codexAsyncQuestions({
      type: "agentMessage",
      delivery: "async",
      questions: [
        { title: "Which scope?", options: ["Workspace", "Folder"] },
        { title: "Which scope?", options: null },
      ],
    });
    expect(questions).toMatchObject([
      {
        id: "q1",
        prompt: "Which scope?",
        allowCustom: true,
        options: [{ label: "Workspace" }, { label: "Folder" }],
      },
      { id: "q2", prompt: "Which scope?", allowCustom: true, options: [] },
    ]);
    expect(
      codexAsyncQuestionResponse(questions, {
        kind: "answered",
        answers: { q1: ["Folder"] },
        custom: { q2: "Selected files" },
      }),
    ).toBe("Which scope?\nFolder\n\nWhich scope?\nSelected files");
  });

  it("sends custom text instead of the Other option and omits skipped questions", () => {
    const questions = codexAsyncQuestions({
      type: "agentMessage",
      delivery: "async",
      questions: [
        { title: "Choose a source", options: ["Local"] },
        { title: "Anything else?", options: [] },
      ],
    });
    expect(
      codexAsyncQuestionResponse(questions, {
        kind: "answered",
        answers: { q1: [CUSTOM_OPTION_ID] },
        custom: { q1: "External source" },
      }),
    ).toBe("Choose a source\nExternal source");
    expect(codexAsyncQuestionResponse(questions, { kind: "skipped" })).toBe("");
  });

  it.each([
    { type: "agentMessage", questions: [{ title: "Ordinary message" }] },
    { type: "agentMessage", delivery: "async", questions: null },
    { type: "agentMessage", delivery: "async", questions: [] },
    { type: "reasoning", delivery: "async", questions: [{ title: "Why?" }] },
  ])("ignores items without async questions", (item) => {
    expect(codexAsyncQuestions(item)).toEqual([]);
  });

  it.each([
    {},
    [{ title: " " }],
    [{ title: "Choice", options: {} }],
    [{ title: "Choice", options: [{ label: "Local" }] }],
    [{ title: "Choice", options: [" "] }],
    [{ title: "Secret", isSecret: true }],
  ])("rejects malformed async questions", (questions) => {
    expect(() =>
      codexAsyncQuestions({
        type: "agentMessage",
        delivery: "async",
        questions,
      }),
    ).toThrow();
  });
});
