import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/archive-files.json";
import { compareMemoryArchiveFiles } from "@/modules/workspace-kit/lib/archiveFiles";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { snapshotMemoryPreservation } from "@/modules/workspace-kit/lib/preservation";

function documents(input: object): Map<string, KitPathFact> {
  const files = new Map<string, KitPathFact>(
    [
      "PROJECT.md",
      "CONTEXT.md",
      "plans/INDEX.md",
      "plans/TRACKING.md",
      "continuity/CHANGELOG.md",
      "archive/LOG.md",
    ].map((path) => [path, { kind: "file", text: "" }]),
  );
  for (const [path, text] of Object.entries(input))
    files.set(path, { kind: "file", text });
  return files;
}

it.each(corpus.cases)(
  "shares native archive evidence for $name",
  async (test) => {
    const before = await snapshotMemoryPreservation(
      documents(test.before),
      true,
    );
    const after = await snapshotMemoryPreservation(documents(test.after), true);
    const report = compareMemoryArchiveFiles(before, after);
    expect(report).toEqual(test.expected);
    expect(Object.isFrozen(report)).toBe(true);
    for (const value of Object.values(report))
      expect(Object.isFrozen(value)).toBe(true);
    for (const move of report.moves) expect(Object.isFrozen(move)).toBe(true);
  },
);
