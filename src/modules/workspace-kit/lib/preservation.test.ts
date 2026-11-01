import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/preservation.json";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import {
  compareMemoryPreservation,
  snapshotMemoryPreservation,
} from "@/modules/workspace-kit/lib/preservation";

const facts = (input: object) =>
  new Map(Object.entries(input)) as Map<string, KitPathFact>;
it.each(corpus.snapshots)("shares native snapshots for $name", async (test) => {
  expect(await snapshotMemoryPreservation(facts(test.documents), true)).toEqual(
    test.expected,
  );
});
it.each(corpus.comparisons)(
  "shares native loss diagnostics for $name",
  async (test) => {
    const before = await snapshotMemoryPreservation(facts(test.before), true);
    const after = await snapshotMemoryPreservation(facts(test.after), true);
    expect(compareMemoryPreservation(before, after)).toEqual(test.expected);
  },
);
it.each(corpus.invalid)(
  "rejects $name instead of making a partial baseline",
  async (test) => {
    await expect(
      snapshotMemoryPreservation(facts(test.documents), test.complete),
    ).rejects.toThrow(test.error);
  },
);
it("captures inputs before hashing and returns immutable snapshots", async () => {
  const files = facts(corpus.comparisons[0].before);
  const pending = snapshotMemoryPreservation(files, true);
  files.clear();
  const snapshot = await pending;
  expect(snapshot.files).toHaveLength(6);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.files)).toBe(true);
  expect(Object.isFrozen(snapshot.files[0])).toBe(true);
  expect(
    snapshot.files.some(
      (file) => file.items.length > 0 && Object.isFrozen(file.items[0]),
    ),
  ).toBe(true);
});
it("bounds files bytes and item metadata and rejects unreadable facts", async () => {
  const base = facts(corpus.comparisons[0].before);
  for (const kind of ["absent", "blocked"] as const) {
    const files = new Map(base).set("CONTEXT.md", { kind });
    await expect(snapshotMemoryPreservation(files, true)).rejects.toThrow(
      "KIT_PRESERVATION_INCOMPLETE",
    );
  }
  const many = new Map(base);
  for (let n = 0; n < 123; n += 1)
    many.set(`domains/${n}.md`, { kind: "file", text: "" });
  await expect(snapshotMemoryPreservation(many, true)).rejects.toThrow(
    "KIT_PRESERVATION_FILE_LIMIT",
  );
  for (const text of ["[T-1] ".repeat(8193), `[T-${"1".repeat(63)}]`]) {
    await expect(
      snapshotMemoryPreservation(
        new Map(base).set("CONTEXT.md", { kind: "file", text }),
        true,
      ),
    ).rejects.toThrow("KIT_PRESERVATION_ITEM_LIMIT");
  }
  const bytes = new Map(base).set("CONTEXT.md", {
    kind: "file" as const,
    text: "",
  });
  for (let n = 0; n < 17; n += 1)
    bytes.set(`domains/${n}.md`, {
      kind: "file",
      text: "a".repeat(256 * 1024),
    });
  await expect(snapshotMemoryPreservation(bytes, true)).rejects.toThrow(
    "KIT_PRESERVATION_BYTE_LIMIT",
  );
});
