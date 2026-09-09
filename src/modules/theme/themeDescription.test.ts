import { describe, expect, it, vi } from "vitest";
import { resolveThemeDescription } from "./themeDescription";
import type { Theme, ThemeVariation } from "./types";

const theme = (id: string, description?: string): Theme => ({
  id,
  name: id,
  description,
  variants: {},
});

const variation = (id: string, description?: string): ThemeVariation => ({
  id,
  name: id,
  description,
  variants: {},
});

describe("resolveThemeDescription", () => {
  it("translates known built-in themes", () => {
    const t = vi.fn((key: string) => key);

    expect(resolveThemeDescription(t, theme("win31", "raw"))).toBe(
      "themes.descriptions.win31",
    );
  });

  it("translates known Voktty variations", () => {
    const t = vi.fn((key: string) => key);

    expect(
      resolveThemeDescription(
        t,
        theme("voktty-default", "raw"),
        variation("nord", "raw"),
      ),
    ).toBe("themes.descriptions.vokttyDefault.nord");
  });

  it("preserves custom theme descriptions", () => {
    const t = vi.fn((key: string) => key);

    expect(resolveThemeDescription(t, theme("custom", "Custom copy"))).toBe(
      "Custom copy",
    );
  });
});
