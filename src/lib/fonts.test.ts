import { describe, expect, it } from "vitest";
import { resolveFontFamily } from "./fonts";

const FALLBACK = [
  '"JetBrains Mono"',
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  '"MesloLGS NF"',
  '"MesloLGS Nerd Font Mono"',
  '"FiraCode Nerd Font Mono"',
  '"Hack Nerd Font Mono"',
  '"CaskaydiaCove Nerd Font Mono"',
  "Consolas",
  '"Liberation Mono"',
  '"Courier New"',
  "monospace",
].join(", ");

describe("resolveFontFamily", () => {
  it("quotes a bare family and appends the mono fallback", () => {
    expect(resolveFontFamily("JetBrainsMono Nerd Font")).toBe(
      `"JetBrainsMono Nerd Font", ${FALLBACK}`,
    );
  });

  it("does not double-quote an already-quoted family", () => {
    expect(resolveFontFamily('"Fira Code"')).toBe(`"Fira Code", ${FALLBACK}`);
  });

  it("passes a comma-separated stack through and still appends fallback", () => {
    expect(resolveFontFamily("Foo, Bar")).toBe(`Foo, Bar, ${FALLBACK}`);
  });

  it("keeps Nerd Font symbol families after the user's preferred stack", () => {
    const family = resolveFontFamily('"Custom Font", ui-monospace');
    expect(family).toBe(`"Custom Font", ui-monospace, ${FALLBACK}`);
    expect(family.indexOf('"Symbols Nerd Font Mono"')).toBeGreaterThan(
      family.indexOf("ui-monospace"),
    );
  });

  it("strips stray internal quotes to avoid a malformed token", () => {
    expect(resolveFontFamily('Foo"Bar')).toBe(`"FooBar", ${FALLBACK}`);
  });

  it("trims surrounding whitespace before quoting", () => {
    expect(resolveFontFamily("  Hack Nerd Font  ")).toBe(
      `"Hack Nerd Font", ${FALLBACK}`,
    );
  });

  it("falls back to the mono chain for empty input", () => {
    expect(resolveFontFamily("")).toBe(FALLBACK);
    expect(resolveFontFamily("   ")).toBe(FALLBACK);
  });
});
