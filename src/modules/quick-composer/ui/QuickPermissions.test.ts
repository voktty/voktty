import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuickPermissions, QUICK_RUNTIME_MODES } from "./QuickPermissions";
import { RUNTIME_MODE_LABEL, RUNTIME_MODE_HINT } from "@/modules/harness/lib/session";

describe("QuickPermissions", () => {
  it("renders all four runtime modes with hints and selected state", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickPermissions, {
        value: "supervised",
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('role="listbox"');
    for (const mode of QUICK_RUNTIME_MODES) {
      expect(markup).toContain(RUNTIME_MODE_LABEL[mode]);
      expect(markup).toContain(RUNTIME_MODE_HINT[mode]);
    }
    expect(markup).toContain('aria-selected="true"');
  });

  it("marks the active permission mode as selected", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickPermissions, {
        value: "full-access",
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('role="option"');
    expect(markup).toContain(RUNTIME_MODE_LABEL["full-access"]);
  });
});
