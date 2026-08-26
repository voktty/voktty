import { describe, expect, it } from "vitest";
import { buildQuickFixPrompt } from "./agenticQuickFix";
import type { Diagnostic } from "@codemirror/lint";

describe("buildQuickFixPrompt", () => {
  it("builds prompt from diagnostic error messages", () => {
    const diags: Diagnostic[] = [
      {
        from: 10,
        to: 20,
        severity: "error",
        message: "TS2304: Cannot find name 'userConfig'",
      },
    ];
    const prompt = buildQuickFixPrompt(diags);
    expect(prompt).toContain("TS2304: Cannot find name 'userConfig'");
    expect(prompt).toContain("ERROR");
  });

  it("handles multiple diagnostics", () => {
    const diags: Diagnostic[] = [
      {
        from: 5,
        to: 15,
        severity: "warning",
        message: "Variable 'unused' is declared but never used",
      },
      {
        from: 20,
        to: 30,
        severity: "error",
        message: "Property 'id' does not exist on type 'User'",
      },
    ];
    const prompt = buildQuickFixPrompt(diags);
    expect(prompt).toContain("WARNING");
    expect(prompt).toContain("ERROR");
    expect(prompt).toContain("Property 'id' does not exist");
  });

  it("returns fallback prompt if empty", () => {
    const prompt = buildQuickFixPrompt([]);
    expect(prompt).toContain("Analyze and fix");
  });
});
