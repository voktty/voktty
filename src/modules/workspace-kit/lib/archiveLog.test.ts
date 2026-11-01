import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/archive-log.json";
import { checkMemoryArchiveLog } from "@/modules/workspace-kit/lib/archiveLog";
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
type Case = {
  name: string;
  before: Record<string, string>;
  after: Record<string, string>;
  suppliedBeforeLog?: string;
  suppliedAfterLog?: string;
  error?: string;
  expected?: unknown;
};
it.each(corpus.cases as Case[])(
  "shares native archive LOG evidence for $name",
  async (test) => {
    const before = await snapshotMemoryPreservation(
      documents(test.before),
      true,
    );
    const after = await snapshotMemoryPreservation(documents(test.after), true);
    const result = checkMemoryArchiveLog(
      before,
      after,
      test.suppliedBeforeLog ?? test.before["archive/LOG.md"] ?? "",
      test.suppliedAfterLog ?? test.after["archive/LOG.md"] ?? "",
    );
    if (test.error) await expect(result).rejects.toThrow(test.error);
    else {
      const report = await result;
      expect(report).toEqual(test.expected);
      expect(Object.isFrozen(report)).toBe(true);
      for (const value of Object.values(report))
        if (Array.isArray(value)) expect(Object.isFrozen(value)).toBe(true);
    }
  },
);
it("enforces text and record budgets before returning evidence", async () => {
  const snapshot = await snapshotMemoryPreservation(documents({}), true);
  await expect(
    checkMemoryArchiveLog(snapshot, snapshot, "", "x".repeat(262145)),
  ).rejects.toThrow("KIT_ARCHIVE_LOG_LIMIT");
  const many = "VOKTTY-unknown\n".repeat(1025);
  const after = await snapshotMemoryPreservation(
    documents({ "archive/LOG.md": many }),
    true,
  );
  await expect(
    checkMemoryArchiveLog(snapshot, after, "", many),
  ).rejects.toThrow("KIT_ARCHIVE_LOG_LIMIT");
  const log = `VOKTTY-${"x".repeat(16384)}\n`;
  const bound = await snapshotMemoryPreservation(
    documents({ "archive/LOG.md": log }),
    true,
  );
  expect(await checkMemoryArchiveLog(snapshot, bound, "", log)).toMatchObject({
    complete: false,
    invalidLines: [1],
  });
  await expect(
    checkMemoryArchiveLog(snapshot, snapshot, "", "\ud800"),
  ).rejects.toThrow("KIT_ARCHIVE_LOG_CHANGED");
});
