import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

describe("SearchableSelect", () => {
  it("renders with closed trigger by default", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchableSelect, {
        label: "Agent",
        value: "codex",
        options: [
          { value: "codex", label: "Codex" },
          { value: "claude", label: "Claude" },
        ],
        onChange: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Codex");
  });

  it("renders pill variant with compact button styling", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchableSelect, {
        label: "Timeout",
        value: "60",
        variant: "pill",
        searchable: false,
        options: [
          { value: "30", label: "30 sec" },
          { value: "60", label: "1 min" },
        ],
        onChange: vi.fn(),
      }),
    );

    expect(markup).toContain("1 min");
    expect(markup).toContain("rounded-md");
  });
});
