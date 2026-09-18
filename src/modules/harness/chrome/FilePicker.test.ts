import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FilePicker } from "./FilePicker";

describe("FilePicker", () => {
  it("renders Go to File dialog with default query", () => {
    const html = renderToStaticMarkup(
      createElement(FilePicker, {
        open: true,
        cwd: "/test/project",
        onOpenFile: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Go to File"');
    expect(html).toContain('placeholder="Go to File (type &gt; for commands)"');
  });

  it("renders Command Palette dialog when initialQuery is >", () => {
    const html = renderToStaticMarkup(
      createElement(FilePicker, {
        open: true,
        cwd: "/test/project",
        initialQuery: ">",
        onOpenFile: vi.fn(),
        onRunAction: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Command Palette"');
    expect(html).toContain('placeholder="Command Palette"');
    expect(html).toContain("Reload Voktty");
  });
});
