import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/archive-plan-time.json";
import handoffCorpus from "@/../templates/workspace-kit/conformance/archive-time.json";
import { checkMemoryArchiveTimeWithSources } from "@/modules/workspace-kit/lib/archiveTime";
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
  "qualifies bound plan closure dates: $name",
  async (test) => {
    const before = await snapshotMemoryPreservation(
      documents(test.before),
      true,
    );
    const after = await snapshotMemoryPreservation(documents(test.after), true);
    const result = checkMemoryArchiveTimeWithSources(
      before,
      after,
      documents(test.sources),
      test.nowMs,
      test.afterDays,
    );
    if ("error" in test) await expect(result).rejects.toThrow(test.error);
    else {
      const report = await result;
      expect(report).toEqual(test.expected);
      expect(Object.isFrozen(report)).toBe(true);
      for (const value of Object.values(report))
        expect(Object.isFrozen(value)).toBe(true);
    }
  },
);

it.each(handoffCorpus.cases)(
  "preserves snapshot-only qualification: $name",
  async (test) => {
    const before = await snapshotMemoryPreservation(
      documents(test.before),
      true,
    );
    const after = await snapshotMemoryPreservation(documents(test.after), true);
    expect(
      await checkMemoryArchiveTimeWithSources(
        before,
        after,
        new Map(),
        test.nowMs,
        test.afterDays,
      ),
    ).toEqual(test.expected);
  },
);

it("captures all previous source bytes before asynchronous hashing", async () => {
  const source = "plans/P.md";
  const fact = { kind: "file" as const, text: "State: closed 2030-01-01\n" };
  const previous = documents({ [source]: fact.text });
  const before = await snapshotMemoryPreservation(previous, true);
  const after = await snapshotMemoryPreservation(
    documents({ "archive/2030-01/P.md": fact.text }),
    true,
  );
  const sources = new Map([[source, fact]]);
  const result = checkMemoryArchiveTimeWithSources(
    before,
    after,
    sources,
    Date.UTC(2030, 2, 1),
    30,
  );
  fact.text = "State: closed 2030-03-01\n";
  sources.clear();
  expect((await result).qualifiedMoves).toEqual([source]);
});

it("keeps blocked evidence unknown and rejects resource or byte violations", async () => {
  const source = "plans/P.md";
  const text = "State: closed 2030-01-01\n";
  const before = await snapshotMemoryPreservation(
    documents({ [source]: text }),
    true,
  );
  const after = await snapshotMemoryPreservation(
    documents({ "archive/2030-01/P.md": text }),
    true,
  );
  const run = (
    sources: Map<string, KitPathFact>,
    now = Date.UTC(2030, 2, 1),
    days = 30,
  ) => checkMemoryArchiveTimeWithSources(before, after, sources, now, days);
  expect(
    (await run(new Map([[source, { kind: "blocked" }]]))).unknownDates,
  ).toEqual([source]);
  await expect(
    run(
      new Map<string, KitPathFact>(
        Array.from({ length: 129 }, (_, i) => [
          `plans/${i}.md`,
          { kind: "file", text },
        ]),
      ),
    ),
  ).rejects.toThrow("KIT_ARCHIVE_TIME_SOURCE_LIMIT");
  await expect(
    run(
      new Map([[source, { kind: "file", text: "a".repeat(256 * 1024 + 1) }]]),
    ),
  ).rejects.toThrow("KIT_ARCHIVE_TIME_SOURCE_LIMIT");
  await expect(
    run(
      new Map([[source, { kind: "file", text: "é".repeat(128 * 1024 + 1) }]]),
    ),
  ).rejects.toThrow("KIT_ARCHIVE_TIME_SOURCE_LIMIT");
  await expect(
    run(new Map([[source, { kind: "file", text: "\ud800" }]])),
  ).rejects.toThrow("KIT_ARCHIVE_TIME_SOURCE_CHANGED");
  await expect(run(new Map(), -1)).rejects.toThrow("KIT_ARCHIVE_TIME_INVALID");
  await expect(run(new Map(), 0, 0)).rejects.toThrow(
    "KIT_ARCHIVE_TIME_INVALID",
  );
});

it("validates the complete captured byte budget before hashing mismatched sources", async () => {
  const text = "State: closed 2030-01-01\n";
  const previous = documents({});
  const current = documents({});
  const sources = new Map<string, KitPathFact>();
  for (let i = 0; i < 17; i += 1) {
    const name = `P${i}.md`;
    previous.set(`plans/${name}`, { kind: "file", text });
    current.set(`archive/2030-01/${name}`, { kind: "file", text });
    sources.set(`plans/${name}`, {
      kind: "file",
      text: "a".repeat(256 * 1024),
    });
  }
  const before = await snapshotMemoryPreservation(previous, true);
  const after = await snapshotMemoryPreservation(current, true);
  await expect(
    checkMemoryArchiveTimeWithSources(before, after, sources, 0, 30),
  ).rejects.toThrow("KIT_ARCHIVE_TIME_SOURCE_LIMIT");
});
