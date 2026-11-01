import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/archive-links.json";
import { checkMemoryArchiveLinks } from "@/modules/workspace-kit/lib/archiveLinks";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { snapshotMemoryPreservation } from "@/modules/workspace-kit/lib/preservation";

function documents(input: object): Map<string, KitPathFact> {
  const result = new Map<string, KitPathFact>(
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
    result.set(path, { kind: "file", text });
  return result;
}

it.each(corpus.cases)(
  "qualifies source-bound archive navigation: $name",
  async (test) => {
    const previous = documents(test.before),
      current = documents(test.after);
    const before = await snapshotMemoryPreservation(previous, true),
      after = await snapshotMemoryPreservation(current, true);
    const { fragments, ...navigation } = await checkMemoryArchiveLinks(
      before,
      after,
      previous,
      current,
      corpus.nowMs,
      corpus.afterDays,
    );
    expect(navigation).toEqual(test.expected);
    expect(fragments.fragments).toHaveLength(test.fragmentCount);
    for (const [key, value] of Object.entries(fragments))
      if (key !== "fragments") expect(value).toEqual([]);
    expect(Object.isFrozen(navigation.linkedFragments)).toBe(true);
  },
);

it("captures sources and hash identities before awaiting and rejects changed evidence", async () => {
  const test = corpus.cases[0];
  const previous = documents(test.before),
    current = documents(test.after);
  const before = await snapshotMemoryPreservation(previous, true),
    after = await snapshotMemoryPreservation(current, true);
  const mutable = { ...after, files: after.files.map((file) => ({ ...file })) };
  const pending = checkMemoryArchiveLinks(
    before,
    mutable,
    previous,
    current,
    corpus.nowMs,
    30,
  );
  mutable.files[0].sha256 = "0".repeat(64);
  current.clear();
  expect((await pending).linkedFragments).toEqual(
    test.expected.linkedFragments,
  );
  const changed = documents(test.after);
  changed.set("PROJECT.md", { kind: "file", text: "Forged" });
  await expect(
    checkMemoryArchiveLinks(before, after, previous, changed, corpus.nowMs, 30),
  ).rejects.toThrow("KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED");
});
