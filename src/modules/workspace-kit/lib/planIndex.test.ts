import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/plan-index.json";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { checkMemoryPlanIndex } from "@/modules/workspace-kit/lib/planIndex";
import { snapshotMemoryPreservation } from "@/modules/workspace-kit/lib/preservation";

function documents(text: string, plans: object): Map<string, KitPathFact> {
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
  files.set("plans/INDEX.md", { kind: "file", text });
  for (const [path, state] of Object.entries(plans))
    files.set(path, { kind: "file", text: `State: ${state}\n` });
  return files;
}
it.each(corpus.cases)(
  "shares native plan index qualification for $name",
  async (test) => {
    const snapshot = await snapshotMemoryPreservation(
      documents(test.text, test.plans),
      true,
    );
    expect(await checkMemoryPlanIndex(snapshot, test.text)).toEqual(
      test.expected,
    );
  },
);
it("rejects changed bytes and enforces link and unknown-line limits", async () => {
  const snapshot = await snapshotMemoryPreservation(documents("", {}), true);
  await expect(
    checkMemoryPlanIndex(snapshot, "[Topic](topic.md)"),
  ).rejects.toThrow("KIT_PLAN_INDEX_CHANGED");
  await expect(
    checkMemoryPlanIndex(snapshot, "a".repeat(262145)),
  ).rejects.toThrow("KIT_MEMORY_TEXT_TOO_LARGE");
  for (const text of [
    "[Topic](topic.md)\n".repeat(1025),
    "[Topic][ref]\n".repeat(1025),
    "    [Topic](topic.md)\n".repeat(1025),
  ]) {
    const snapshot = await snapshotMemoryPreservation(
      documents(text, {}),
      true,
    );
    await expect(checkMemoryPlanIndex(snapshot, text)).rejects.toThrow(
      "KIT_PLAN_INDEX_LIMIT",
    );
  }
  for (const text of [
    `[P](${"x".repeat(4097)}.md)`,
    `[P](${"(".repeat(16)}topic.md${")".repeat(16)})`,
  ]) {
    const snapshot = await snapshotMemoryPreservation(
      documents(text, {}),
      true,
    );
    const result = await checkMemoryPlanIndex(snapshot, text);
    expect(result.complete).toBe(false);
    expect(result.unverifiedLines).toEqual([1]);
  }
  const escapedText = `${"\\".repeat(100000)}[Topic](topic.md)`;
  const escapedSnapshot = await snapshotMemoryPreservation(
    documents(escapedText, { "plans/topic.md": "open" }),
    true,
  );
  expect(
    (await checkMemoryPlanIndex(escapedSnapshot, escapedText)).linkedPlans,
  ).toEqual(["plans/topic.md"]);
  const longDestination = `[P](${"\\".repeat(100000)})`;
  const longSnapshot = await snapshotMemoryPreservation(
    documents(longDestination, {}),
    true,
  );
  expect(
    (await checkMemoryPlanIndex(longSnapshot, longDestination)).complete,
  ).toBe(false);
});
