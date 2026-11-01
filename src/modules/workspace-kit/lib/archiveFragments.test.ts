import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/archive-fragments.json";
import { checkMemoryArchiveFragments } from "@/modules/workspace-kit/lib/archiveFragments";
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

function positiveCase() {
  const test = corpus.cases.find(
    (entry) => entry.name === "list block preserves the complete reason",
  );
  if (!test) throw new Error("Missing positive fragment fixture");
  return test;
}

it.each(corpus.cases)(
  "verifies intact fragment evidence: $name",
  async (test) => {
    const previous = documents(test.before);
    const current = documents(test.after);
    const before = await snapshotMemoryPreservation(previous, true);
    const after = await snapshotMemoryPreservation(current, true);
    const report = await checkMemoryArchiveFragments(
      before,
      after,
      previous,
      current,
      test.nowMs,
      test.afterDays,
    );
    expect(report).toEqual(test.expected);
    expect(Object.isFrozen(report)).toBe(true);
    for (const value of Object.values(report))
      expect(Object.isFrozen(value)).toBe(true);
    for (const fragment of report.fragments)
      expect(Object.isFrozen(fragment)).toBe(true);
  },
);

it("captures both inventories and expected hashes before asynchronous work", async () => {
  const test = positiveCase();
  const previous = documents(test.before);
  const current = documents(test.after);
  const before = await snapshotMemoryPreservation(previous, true);
  const after = await snapshotMemoryPreservation(current, true);
  const mutableBefore = {
    ...before,
    files: before.files.map((file) => ({ ...file })),
  };
  const result = checkMemoryArchiveFragments(
    mutableBefore,
    after,
    previous,
    current,
    test.nowMs,
    test.afterDays,
  );
  mutableBefore.files[0].sha256 = "0".repeat(64);
  previous.clear();
  current.clear();
  expect(await result).toEqual(test.expected);
});

it("rejects changed, unavailable, excessive and invalid evidence before reporting", async () => {
  const test = positiveCase();
  const previous = documents(test.before);
  const current = documents(test.after);
  const before = await snapshotMemoryPreservation(previous, true);
  const after = await snapshotMemoryPreservation(current, true);
  previous.set("PROJECT.md", { kind: "file", text: "Changed" });
  await expect(
    checkMemoryArchiveFragments(
      before,
      after,
      previous,
      current,
      test.nowMs,
      30,
    ),
  ).rejects.toThrow("KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED");
  previous.set("PROJECT.md", { kind: "file", text: "" });
  current.set("PROJECT.md", { kind: "file", text: "Changed after" });
  await expect(
    checkMemoryArchiveFragments(
      before,
      after,
      previous,
      current,
      test.nowMs,
      30,
    ),
  ).rejects.toThrow("KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED");
  current.set("PROJECT.md", { kind: "file", text: "" });
  previous.set("PROJECT.md", { kind: "blocked" });
  await expect(
    checkMemoryArchiveFragments(
      before,
      after,
      previous,
      current,
      test.nowMs,
      30,
    ),
  ).rejects.toThrow("KIT_PRESERVATION_INCOMPLETE");
  const many = new Map<string, KitPathFact>(
    Array.from({ length: 129 }, (_, index) => [
      `domains/${index}.md`,
      { kind: "file", text: "" },
    ]),
  );
  await expect(
    checkMemoryArchiveFragments(before, after, many, current, test.nowMs, 30),
  ).rejects.toThrow("KIT_PRESERVATION_FILE_LIMIT");
  await expect(
    checkMemoryArchiveFragments(before, after, previous, current, -1, 30),
  ).rejects.toThrow("KIT_ARCHIVE_TIME_INVALID");
});

it("admits the exact comparison budget without skipping missing evidence", async () => {
  const old = Array.from(
    { length: 256 },
    (_, i) => `- [T-${i + 1} done] Done · closed 2030-01-01\n`,
  ).join("");
  const previous = documents({ "plans/TRACKING.md": old });
  const current = documents({ "plans/TRACKING.md": "x".repeat(256 * 1024) });
  const before = await snapshotMemoryPreservation(previous, true);
  const after = await snapshotMemoryPreservation(current, true);
  const report = await checkMemoryArchiveFragments(
    before,
    after,
    previous,
    current,
    2000000000000,
    30,
  );
  expect(report.missingFragments).toHaveLength(256);
  expect(report.fragments).toEqual([]);
});

it("fails explicitly on exhausted block and boundary budgets", async () => {
  for (const old of [
    Array.from(
      { length: 257 },
      (_, i) => `- [T-${i + 1} done] Done · closed 2030-01-01\n`,
    ).join(""),
    `${"# H\n".repeat(1025)}- [T-1 done] Done · closed 2030-01-01\n`,
  ]) {
    const previous = documents({ "plans/TRACKING.md": old });
    const current = documents({});
    const before = await snapshotMemoryPreservation(previous, true);
    const after = await snapshotMemoryPreservation(current, true);
    await expect(
      checkMemoryArchiveFragments(
        before,
        after,
        previous,
        current,
        2000000000000,
        30,
      ),
    ).rejects.toThrow("KIT_ARCHIVE_FRAGMENT_LIMIT");
  }
});
