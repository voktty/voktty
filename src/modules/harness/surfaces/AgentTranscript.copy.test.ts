import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";

describe("AgentTranscript copy and notes actions", () => {
  it("shows the user's send time next to the message actions", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          {
            id: "prompt",
            role: "user",
            text: "Hello",
            startedAt: Date.UTC(2026, 8, 17, 12, 30),
          },
        ],
      }),
    );
    expect(markup).toContain('dateTime="2026-09-17T12:30:00.000Z"');
    expect(markup).toContain('aria-label="Copy message"');
    expect(markup).toContain("user-message-actions");
  });

  it("renders user message actions with copy and notes buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          {
            id: "prompt",
            role: "user",
            text: "Keep this prompt\nWith its formatting",
          },
        ],
        onSaveNote: vi.fn(),
      }),
    );
    expect(markup).toContain('aria-label="Copy message"');
    expect(markup).toContain('aria-label="Save as note"');
    expect(markup).toContain("user-message-hover-zone");
    expect(markup).toContain("user-message-row");
  });

  it("renders copy button on user message with attachments", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          {
            id: "image",
            role: "user",
            text: "",
            attachments: [
              {
                id: "a",
                name: "picture.png",
                mimeType: "image/png",
                kind: "image",
                size: 3,
                data: "YWJj",
              },
            ],
          },
        ],
      }),
    );
    expect(markup).toContain('aria-label="Copy message"');
  });

  it("renders selectable data attribute for user prompt", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          {
            id: "prompt123",
            role: "user",
            text: "Selectable text",
          },
        ],
      }),
    );
    expect(markup).toContain('data-selectable-agent-response="prompt123"');
  });
});
