import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CHROME = fileURLToPath(new URL(".", import.meta.url));
const THEMED_SHELLS = [
  "ApprovalToasts.tsx",
  "FileMentionPicker.tsx",
  "FilePicker.tsx",
  "RemoveProjectDialog.tsx",
  "SkillPicker.tsx",
  "SwitchBranchDialog.tsx",
  "UpdateToast.tsx",
];
const HARNESS_ONLY_SURFACE =
  /bg-\[#[0-9a-f]+\]|border-zinc-|text-zinc-|shadow-black\/|backdrop-blur-(?:xl|2xl)/i;

describe("Harness chrome theme contract", () => {
  it("keeps structural floating shells on Voktty semantic surfaces", () => {
    for (const file of THEMED_SHELLS) {
      const source = readFileSync(`${CHROME}/${file}`, "utf8");

      expect(source, file).toContain("voktty-floating-surface");
      expect(source, file).not.toMatch(HARNESS_ONLY_SURFACE);
    }
  });
});
