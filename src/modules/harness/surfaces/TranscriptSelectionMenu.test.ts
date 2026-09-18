import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<object>("react-dom");
  return {
    ...actual,
    createPortal: (children: unknown) => children,
  };
});

describe("TranscriptSelectionMenu", () => {
  it("renders selection toolbar with Add to chat and Add to notes", () => {
    (globalThis as unknown as { document: { body: object } }).document = {
      body: {},
    };
    const onAddToChat = vi.fn();
    const onAddToNotes = vi.fn();
    const onDismiss = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(TranscriptSelectionMenu, {
        selection: {
          text: "A useful link",
          rect: {
            top: 20,
            left: 10,
            bottom: 40,
            right: 110,
            width: 100,
            height: 20,
            x: 10,
            y: 20,
            toJSON: () => {},
          },
        },
        onAddToChat,
        onAddToNotes,
        onDismiss,
      }),
    );

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain("Add to chat");
    expect(markup).toContain("Add to notes");
  });

  it("renders null when selection is null", () => {
    const markup = renderToStaticMarkup(
      createElement(TranscriptSelectionMenu, {
        selection: null,
        onDismiss: vi.fn(),
      }),
    );
    expect(markup).toBe("");
  });
});
