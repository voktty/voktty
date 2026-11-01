import { expect, it, vi } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/protected.json";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import {
  compareMemoryProtected,
  isMemoryProtectedPath,
  memoryProtectedPaths,
  snapshotMemoryProtected,
} from "@/modules/workspace-kit/lib/protected";

function facts(overrides: object = {}) {
  return new Map<string, KitPathFact>([
    ...corpus.requiredPaths.map((path): [string, KitPathFact] => [
      path,
      { kind: "absent" },
    ]),
    ...(Object.entries(overrides) as [string, KitPathFact][]),
  ]);
}

it("derives the fixed project-relative inventory from the packaged manifest", () => {
  expect(memoryProtectedPaths()).toEqual(corpus.requiredPaths);
  expect(Object.isFrozen(memoryProtectedPaths())).toBe(true);
});
it.each(corpus.snapshots)(
  "preserves $name without interpreting its text",
  async (test) => {
    const snapshot = await snapshotMemoryProtected(facts(test.documents), true);
    expect(snapshot.files.filter((entry) => entry.kind === "file")).toEqual(
      test.expected,
    );
    expect(
      snapshot.files
        .filter((entry) => entry.kind === "absent")
        .every((entry) => entry.sha256 === null && entry.bytes === null),
    ).toBe(true);
  },
);
it.each(corpus.comparisons)(
  "shares native protected comparison for $name",
  async (test) => {
    const before = await snapshotMemoryProtected(facts(test.before), true);
    const after = await snapshotMemoryProtected(facts(test.after), true);
    expect(compareMemoryProtected(before, after)).toEqual(test.expected);
  },
);
it.each(corpus.invalidPaths)(
  "refuses unqualified protected path %s",
  async (path) => {
    expect(isMemoryProtectedPath(path)).toBe(false);
    await expect(
      snapshotMemoryProtected(
        facts().set(path, { kind: "file", text: "" }),
        true,
      ),
    ).rejects.toThrow("KIT_PROTECTED_PATH_INVALID");
  },
);
it("distinguishes a missing observation from verified absence and never accepts blocked facts", async () => {
  for (const path of corpus.requiredPaths) {
    const missing = facts();
    missing.delete(path);
    await expect(snapshotMemoryProtected(missing, true)).rejects.toThrow(
      "KIT_PROTECTED_INCOMPLETE",
    );
    await expect(
      snapshotMemoryProtected(facts().set(path, { kind: "blocked" }), true),
    ).rejects.toThrow("KIT_PROTECTED_INCOMPLETE");
  }
  await expect(snapshotMemoryProtected(facts(), false)).rejects.toThrow(
    "KIT_PROTECTED_INCOMPLETE",
  );
});
it("captures mutable facts before hashing and freezes every output", async () => {
  const original = {
    kind: "file" as const,
    text: corpus.snapshots[0].documents["AGENTS.md"]?.text ?? "",
  };
  const sources = facts().set("AGENTS.md", original);
  const pending = snapshotMemoryProtected(sources, true);
  original.text = "changed";
  sources.clear();
  const result = await pending;
  expect(result.files.find((file) => file.path === "AGENTS.md")).toEqual(
    corpus.snapshots[0].expected[0],
  );
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.files)).toBe(true);
  expect(result.files.every(Object.isFrozen)).toBe(true);
});
it("preflights bounded text, aggregate bytes and file counts before any asynchronous hash", async () => {
  for (const text of ["a\0b", String.fromCharCode(0xd800)]) {
    await expect(
      snapshotMemoryProtected(
        facts().set("AGENTS.md", { kind: "file", text }),
        true,
      ),
    ).rejects.toThrow("KIT_PROTECTED_TEXT_INVALID");
  }
  const digest = vi.spyOn(crypto.subtle, "digest");
  try {
    const sources = facts();
    for (let n = 0; n < 17; n += 1)
      sources.set(`.voktty/team/roles/role-${n}.md`, {
        kind: "file",
        text: "x".repeat(256 * 1024),
      });
    await expect(snapshotMemoryProtected(sources, true)).rejects.toThrow(
      "KIT_PROTECTED_BYTE_LIMIT",
    );
    await expect(
      snapshotMemoryProtected(
        facts().set("AGENTS.md", { kind: "file", text: "é".repeat(131073) }),
        true,
      ),
    ).rejects.toThrow("KIT_PROTECTED_BYTE_LIMIT");
    const many = facts();
    for (let n = 0; n < 129; n += 1)
      many.set(`.voktty/team/roles/role-${n}.md`, { kind: "absent" });
    await expect(snapshotMemoryProtected(many, true)).rejects.toThrow(
      "KIT_PROTECTED_FILE_LIMIT",
    );
    expect(digest).not.toHaveBeenCalled();
  } finally {
    digest.mockRestore();
  }
});
