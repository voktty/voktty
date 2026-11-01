import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/preservation-live-scope.json";
import { compareMemoryArchiveFiles } from "@/modules/workspace-kit/lib/archiveFiles";
import { checkMemoryArchiveLinks } from "@/modules/workspace-kit/lib/archiveLinks";
import { checkMemoryArchiveLogWithSources } from "@/modules/workspace-kit/lib/archiveLog";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import {
  compareMemoryPreservation,
  snapshotMemoryPreservation,
} from "@/modules/workspace-kit/lib/preservation";

function facts() {
  return new Map<string, KitPathFact>(
    [
      "PROJECT.md",
      "CONTEXT.md",
      "plans/INDEX.md",
      "plans/TRACKING.md",
      "continuity/CHANGELOG.md",
      "archive/LOG.md",
    ].map((path) => [path, { kind: "file", text: "" }]),
  );
}

it.each(corpus.snapshots)("captures factual scope $name", async (test) => {
  const sources = facts().set(test.path, { kind: "file", text: test.text });
  const snapshot = await snapshotMemoryPreservation(sources, true);
  expect(snapshot.files.find((file) => file.path === test.path)).toEqual(
    test.expected,
  );
});

it.each(corpus.invalidPaths)(
  "does not classify static or unsupported %s",
  async (path) => {
    await expect(
      snapshotMemoryPreservation(
        facts().set(path, { kind: "file", text: "" }),
        true,
      ),
    ).rejects.toThrow("KIT_PRESERVATION_PATH_INVALID");
  },
);

it.each(corpus.losses)(
  "retains factual loss diagnostics for $name",
  async (test) => {
    const previous = facts().set(test.path, {
      kind: "file",
      text: test.before,
    });
    const current = facts();
    if (test.after !== null)
      current.set(test.path, { kind: "file", text: test.after });
    if (test.archive !== null)
      current.set("archive/2026-01/old.md", {
        kind: "file",
        text: test.archive,
      });
    if (test.handoff !== null)
      current.set("continuity/handoffs/legacy.md", {
        kind: "file",
        text: test.handoff,
      });
    const before = await snapshotMemoryPreservation(previous, true);
    const after = await snapshotMemoryPreservation(current, true);
    expect(compareMemoryPreservation(before, after)).toEqual(test.expected);
    expect(
      compareMemoryArchiveFiles(before, after).ineligibleRemovedFiles,
    ).toEqual(test.ineligibleRemovedFiles);
  },
);

it.each(corpus.fragments)(
  "checks intact factual fragments and owner links for $name",
  async (test) => {
    const previous = facts().set(test.path, {
      kind: "file",
      text: test.before,
    });
    const current = facts()
      .set(test.path, { kind: "file", text: test.after })
      .set(test.target, { kind: "file", text: test.archive });
    const before = await snapshotMemoryPreservation(previous, true);
    const after = await snapshotMemoryPreservation(current, true);
    const report = await checkMemoryArchiveLinks(
      before,
      after,
      previous,
      current,
      Date.UTC(2026, 10, 1),
      30,
    );
    expect(
      report.fragments.fragments.map(
        (fragment) => `${fragment.source}#L${fragment.line}`,
      ),
    ).toEqual(test.expectedKeys);
    expect(report.fragments.missingFragments).toEqual(test.expectedMissing);
    expect(report.linkedFragments).toEqual(test.expectedKeys);
    expect(report.missingFragments).toEqual([]);
    if (test.expectedKeys.length) {
      expect(report.fragments.fragments[0]).toEqual({
        source: test.path,
        line: 2,
        target: test.target,
        bytes: test.bytes,
        sha256: test.sha256,
      });
    } else {
      expect(report.fragments.unattributedArchives).toEqual([test.target]);
    }
  },
);

it.each(corpus.fragments)(
  "recomputes fragment and size LOG records for $name",
  async (test) => {
    const previous = facts().set(test.path, {
      kind: "file",
      text: test.before,
    });
    const current = facts()
      .set(test.path, { kind: "file", text: test.after })
      .set(test.target, { kind: "file", text: test.archive })
      .set("archive/LOG.md", { kind: "file", text: test.log });
    const before = await snapshotMemoryPreservation(previous, true);
    const after = await snapshotMemoryPreservation(current, true);
    const report = await checkMemoryArchiveLogWithSources(
      before,
      after,
      previous,
      current,
      Date.UTC(2026, 10, 1),
      30,
    );
    expect(report.log).toEqual(test.expectedLog);
    expect(report.loggedFragments).toEqual(test.expectedKeys);
    expect(report.fragments.missingFragments).toEqual(test.expectedMissing);
  },
);
