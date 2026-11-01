import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/archive-fragment-log.json";
import fragments from "@/../templates/workspace-kit/conformance/archive-fragments.json";
import legacy from "@/../templates/workspace-kit/conformance/archive-log.json";
import {
  checkMemoryArchiveLog,
  checkMemoryArchiveLogWithSources,
} from "@/modules/workspace-kit/lib/archiveLog";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { snapshotMemoryPreservation } from "@/modules/workspace-kit/lib/preservation";

type Case = {
  name: string;
  fixture: string;
  beforeLog: string;
  afterLog: string;
  extraBefore?: Record<string, string>;
  extraAfter?: Record<string, string>;
  expected?: unknown;
  error?: string;
};
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
function fixture(test: Case) {
  const source = fragments.cases.find((value) => value.name === test.fixture);
  if (!source) throw new Error("Missing fragment fixture");
  return {
    source,
    previous: documents({
      ...source.before,
      ...test.extraBefore,
      "archive/LOG.md": test.beforeLog,
    }),
    current: documents({
      ...source.after,
      ...test.extraAfter,
      "archive/LOG.md": test.afterLog,
    }),
  };
}

it.each(corpus.cases as Case[])(
  "binds fragment LOG records: $name",
  async (test) => {
    const { source, previous, current } = fixture(test);
    const before = await snapshotMemoryPreservation(previous, true);
    const after = await snapshotMemoryPreservation(current, true);
    const result = checkMemoryArchiveLogWithSources(
      before,
      after,
      previous,
      current,
      source.nowMs,
      source.afterDays,
    );
    if (test.error) await expect(result).rejects.toThrow(test.error);
    else {
      const report = await result;
      const { fragments: proof, ...records } = report;
      expect(records).toEqual(test.expected);
      expect(proof).toEqual(source.expected);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.log)).toBe(true);
      expect(Object.isFrozen(report.loggedFragments)).toBe(true);
      expect(Object.isFrozen(report.missingFragments)).toBe(true);
    }
  },
);

it.each(legacy.cases)(
  "preserves legacy LOG semantics from actual inventories: $name",
  async (test) => {
    const previous = documents(test.before);
    const current = documents(test.after);
    const before = await snapshotMemoryPreservation(previous, true);
    const after = await snapshotMemoryPreservation(current, true);
    const old = previous.get("archive/LOG.md");
    const now = current.get("archive/LOG.md");
    if (old?.kind !== "file" || now?.kind !== "file")
      throw new Error("Missing LOG fixture");
    const expected = await checkMemoryArchiveLog(
      before,
      after,
      old.text,
      now.text,
    ).then(
      (log) => ({ log }),
      (error: Error) => ({ error: error.message }),
    );
    const actual = await checkMemoryArchiveLogWithSources(
      before,
      after,
      previous,
      current,
      2000000000000,
      30,
    ).then(
      ({ log }) => ({ log }),
      (error: Error) => ({ error: error.message }),
    );
    expect(actual).toEqual(expected);
  },
);

it("retains the legacy API rejection of new fragment records", async () => {
  const test = corpus.cases[0];
  const { previous, current } = fixture(test);
  const before = await snapshotMemoryPreservation(previous, true);
  const after = await snapshotMemoryPreservation(current, true);
  const report = await checkMemoryArchiveLog(
    before,
    after,
    test.beforeLog,
    test.afterLog,
  );
  expect(report.invalidLines).toEqual([1]);
  expect(report.complete).toBe(false);
});

it("captures legacy move eligibility and LOG hashes before asynchronous hashing", async () => {
  const text = "State: closed\n[T-1 done] Complete\n";
  const original = await snapshotMemoryPreservation(
    documents({ "plans/P.md": text }),
    true,
  );
  const file = original.files.find((entry) => entry.path === "plans/P.md");
  if (!file) throw new Error("Missing closed plan fixture");
  const row = `VOKTTY-MOVE-1\t2030-03-01\tagent\tplans/P.md\tarchive/2030-01/P.md\t${file.bytes}\t${file.sha256}\n`;
  const after = await snapshotMemoryPreservation(
    documents({ "archive/2030-01/P.md": text, "archive/LOG.md": row }),
    true,
  );
  const before = {
    ...original,
    files: original.files.map((entry) => ({
      ...entry,
      items: entry.items.map((item) => ({ ...item })),
    })),
  };
  const result = checkMemoryArchiveLog(before, after, "", row);
  for (const entry of before.files) {
    entry.sha256 = "0".repeat(64);
    entry.planState = "open";
    for (const item of entry.items) item.state = "open";
  }
  expect((await result).loggedMoves).toEqual(["plans/P.md"]);
});

it("captures sources and original hashes before lazy loading and hashing", async () => {
  const test = corpus.cases[0];
  const { source, previous, current } = fixture(test);
  const snapshot = await snapshotMemoryPreservation(previous, true);
  const before = {
    ...snapshot,
    files: snapshot.files.map((file) => ({ ...file })),
  };
  const after = await snapshotMemoryPreservation(current, true);
  const result = checkMemoryArchiveLogWithSources(
    before,
    after,
    previous,
    current,
    source.nowMs,
    30,
  );
  before.files[0].sha256 = "0".repeat(64);
  previous.clear();
  current.clear();
  const { fragments: proof, ...records } = await result;
  expect(records).toEqual(test.expected);
  expect(proof).toEqual(source.expected);
});

it("rejects mismatched sources, exhausted budgets and invalid settings", async () => {
  const test = corpus.cases[0];
  const { source, previous, current } = fixture(test);
  const before = await snapshotMemoryPreservation(previous, true);
  const after = await snapshotMemoryPreservation(current, true);
  current.set("PROJECT.md", { kind: "file", text: "Changed" });
  await expect(
    checkMemoryArchiveLogWithSources(
      before,
      after,
      previous,
      current,
      source.nowMs,
      30,
    ),
  ).rejects.toThrow("KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED");
  await expect(
    checkMemoryArchiveLogWithSources(before, after, previous, current, -1, 30),
  ).rejects.toThrow("KIT_ARCHIVE_TIME_INVALID");
  const many = new Map<string, KitPathFact>(
    Array.from({ length: 129 }, (_, index) => [
      `domains/${index}.md`,
      { kind: "file", text: "" },
    ]),
  );
  await expect(
    checkMemoryArchiveLogWithSources(
      before,
      after,
      many,
      current,
      source.nowMs,
      30,
    ),
  ).rejects.toThrow("KIT_PRESERVATION_FILE_LIMIT");
  const log = "VOKTTY-unknown\n".repeat(1025);
  const bounded = documents({ "archive/LOG.md": log });
  const boundAfter = await snapshotMemoryPreservation(bounded, true);
  const empty = documents({});
  const boundBefore = await snapshotMemoryPreservation(empty, true);
  await expect(
    checkMemoryArchiveLogWithSources(
      boundBefore,
      boundAfter,
      empty,
      bounded,
      source.nowMs,
      30,
    ),
  ).rejects.toThrow("KIT_ARCHIVE_LOG_LIMIT");
});

it("derives move eligibility from raw sources rather than mutable snapshot metadata", async () => {
  const text = "State: open 2030-01-01\n";
  const previous = documents({ "plans/P.md": text });
  const actualBefore = await snapshotMemoryPreservation(previous, true);
  const file = actualBefore.files.find((entry) => entry.path === "plans/P.md");
  if (!file) throw new Error("Missing plan fixture");
  const row = `VOKTTY-MOVE-1\t2030-03-01\tagent\tplans/P.md\tarchive/2030-01/P.md\t${file.bytes}\t${file.sha256}\n`;
  const current = documents({
    "archive/2030-01/P.md": text,
    "archive/LOG.md": row,
  });
  const after = await snapshotMemoryPreservation(current, true);
  const before = {
    ...actualBefore,
    files: actualBefore.files.map((entry) =>
      entry.path === "plans/P.md"
        ? { ...entry, planState: "closed" as const }
        : entry,
    ),
  };
  const report = await checkMemoryArchiveLogWithSources(
    before,
    after,
    previous,
    current,
    2000000000000,
    30,
  );
  expect(report.log.loggedMoves).toEqual([]);
  expect(report.log.unmatchedLines).toEqual([1]);
  expect(report.fragments.unattributedArchives).toEqual([
    "archive/2030-01/P.md",
  ]);
});
