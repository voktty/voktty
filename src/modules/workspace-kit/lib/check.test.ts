import { expect, it, vi } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/check.json";
import { checkMemoryPreservation } from "@/modules/workspace-kit/lib/check";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import {
  memoryProtectedPaths,
  snapshotMemoryProtected,
  type MemoryProtectedSnapshot,
} from "@/modules/workspace-kit/lib/protected";

function facts(overrides: object = {}) {
  const sources = new Map<string, KitPathFact>(
    [
      "PROJECT.md",
      "CONTEXT.md",
      "plans/INDEX.md",
      "plans/TRACKING.md",
      "continuity/CHANGELOG.md",
      "archive/LOG.md",
    ].map((p) => [p, { kind: "file", text: "" }]),
  );
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) sources.delete(path);
    else sources.set(path, { kind: "file", text });
  }
  return sources;
}
function protectedFacts(overrides: object = {}) {
  return new Map<string, KitPathFact>([
    ...memoryProtectedPaths().map((p): [string, KitPathFact] => [
      p,
      { kind: "absent" },
    ]),
    ...(Object.entries(overrides) as [string, KitPathFact][]),
  ]);
}
function at(object: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      object,
    );
}

it.each(corpus.cases)("composes every check for $name", async (test) => {
  const before = await snapshotMemoryProtected(
    protectedFacts(test.protectedBefore),
    true,
  );
  const after = await snapshotMemoryProtected(
    protectedFacts(test.protectedAfter),
    true,
  );
  const pending = checkMemoryPreservation(
    facts(test.before),
    facts(test.after),
    before,
    after,
    test.nowMs,
    test.afterDays,
  );
  if (test.error) {
    await expect(pending).rejects.toThrow(test.error);
    return;
  }
  const report = await pending;
  expect(report.issues.map((issue) => issue.code).sort()).toEqual(
    test.expectedCodes,
  );
  expect(report.qualifiedAppends).toEqual(test.expectedAppends);
  for (const [path, expected] of Object.entries(test.raw))
    expect(at(report, path), path).toEqual(expected);
  for (const [code, subjects] of Object.entries(test.subjects))
    expect(
      report.issues.find((issue) => issue.code === code)?.subjects,
      code,
    ).toEqual(subjects);
});

it("captures factual and protected inputs before hashing and preserves original losses", async () => {
  const before = facts({ "CONTEXT.md": "[T-1]\n" });
  const original = { kind: "file" as const, text: "" };
  const after = facts().set("CONTEXT.md", original);
  const oldGuard = await snapshotMemoryProtected(
    protectedFacts({ "AGENTS.md": { kind: "file", text: "old" } }),
    true,
  );
  const newGuard = await snapshotMemoryProtected(
    protectedFacts({ "AGENTS.md": { kind: "file", text: "new" } }),
    true,
  );
  const mutable = {
    schema: 1 as const,
    files: newGuard.files.map((f) => ({ ...f })),
  };
  const pending = checkMemoryPreservation(
    before,
    after,
    oldGuard,
    mutable,
    Date.UTC(2026, 10, 1),
    30,
  );
  original.text = "[T-1]\n";
  before.clear();
  after.clear();
  const file = mutable.files.find((f) => f.path === "AGENTS.md");
  if (file)
    file.sha256 =
      oldGuard.files.find((f) => f.path === "AGENTS.md")?.sha256 ?? null;
  const report = await pending;
  expect(report.preservation.missingLiveItems).toEqual(["T-1"]);
  expect(report.protected.changedFiles).toEqual(["AGENTS.md"]);
  expect(Object.isFrozen(report)).toBe(true);
  expect(Object.isFrozen(report.issues)).toBe(true);
  expect(
    report.issues.every(
      (issue) => Object.isFrozen(issue) && Object.isFrozen(issue.subjects),
    ),
  ).toBe(true);
});

it("rejects omitted protected observations and bounds combined resources before asynchronous work", async () => {
  const protectedSnapshot = await snapshotMemoryProtected(
    protectedFacts(),
    true,
  );
  await expect(
    checkMemoryPreservation(
      facts(),
      facts(),
      { schema: 1, files: [] },
      protectedSnapshot,
      0,
      30,
    ),
  ).rejects.toThrow("KIT_CHECK_PROTECTED_INVALID");
  const sources = facts();
  for (let n = 0; n < 128; n += 1)
    sources.set(`domains/${n}.md`, { kind: "file", text: "" });
  const digest = vi.spyOn(crypto.subtle, "digest");
  try {
    await expect(
      checkMemoryPreservation(
        sources,
        facts(),
        protectedSnapshot,
        protectedSnapshot,
        0,
        30,
      ),
    ).rejects.toThrow("KIT_CHECK_LIMIT");
    expect(digest).not.toHaveBeenCalled();
  } finally {
    digest.mockRestore();
  }
});

it.each(["schema", "duplicate", "hash", "absence", "path"])(
  "rejects malformed protected metadata: %s",
  async (kind) => {
    const original = await snapshotMemoryProtected(protectedFacts(), true);
    const mutable: { schema: number; files: object[] } = {
      schema: 1,
      files: original.files.map((f) => ({ ...f })),
    };
    if (kind === "schema") mutable.schema = 2;
    else if (kind === "duplicate") mutable.files.push(mutable.files[0]);
    else if (kind === "hash")
      mutable.files[0] = {
        ...original.files[0],
        kind: "file",
        sha256: "invalid",
        bytes: 1,
      };
    else if (kind === "absence")
      mutable.files[0] = { ...original.files[0], bytes: 0 };
    else
      mutable.files[0] = {
        ...original.files[0],
        path: ".voktty/state/forged.json",
      };
    await expect(
      checkMemoryPreservation(
        facts(),
        facts(),
        mutable as unknown as MemoryProtectedSnapshot,
        original,
        0,
        30,
      ),
    ).rejects.toThrow("KIT_CHECK_PROTECTED_INVALID");
  },
);
