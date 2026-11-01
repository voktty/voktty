import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/archive-time.json";
import { checkMemoryArchiveTime } from "@/modules/workspace-kit/lib/archiveTime";
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

it.each(corpus.cases)("qualifies archive time: $name", async (test) => {
  const before = await snapshotMemoryPreservation(documents(test.before), true);
  const after = await snapshotMemoryPreservation(documents(test.after), true);
  const report = checkMemoryArchiveTime(
    before,
    after,
    test.nowMs,
    test.afterDays,
  );
  expect(report).toEqual(test.expected);
  expect(Object.isFrozen(report)).toBe(true);
  for (const value of Object.values(report))
    expect(Object.isFrozen(value)).toBe(true);
});

it.each([
  [-1, 30],
  [0.5, 30],
  [NaN, 30],
  [Infinity, 30],
  [8640000000000001, 30],
  [Number.MAX_SAFE_INTEGER + 1, 30],
  [0, 0],
  [0, -1],
  [0, 1.5],
  [0, 36501],
  [0, NaN],
  [0, Infinity],
])(
  "rejects invalid temporal settings %s/%s even without moves",
  async (now, days) => {
    const snapshot = await snapshotMemoryPreservation(documents({}), true);
    expect(() => checkMemoryArchiveTime(snapshot, snapshot, now, days)).toThrow(
      "KIT_ARCHIVE_TIME_INVALID",
    );
  },
);
