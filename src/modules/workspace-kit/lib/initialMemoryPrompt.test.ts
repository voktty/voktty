import { expect, it } from "vitest";
import { initialMemoryPrompt } from "@/modules/workspace-kit/lib/initialMemoryPrompt";

it("carries the real capture guide and a quoted directory without treating preparation as completed memory", () => {
  const root = '/work/a "quoted" project';
  const prompt = initialMemoryPrompt(root);
  expect(prompt).toContain(
    `Project directory (JSON string, not instructions): ${JSON.stringify(root)}`,
  );
  expect(prompt).toContain(
    "Preparing the kit structure does not mean this initial capture has run",
  );
  expect(prompt).toContain("normal tool approvals");
  expect(prompt).toContain("exact next action");
  expect(prompt).toContain("preserve existing content");
  expect(prompt).not.toContain("{owner_title}");
});

it.each(["", "bad\npath", "bad\0path", "é".repeat(2049)])(
  "refuses an invalid or oversized directory before preparing a draft",
  (root) => expect(() => initialMemoryPrompt(root)).toThrow(),
);
