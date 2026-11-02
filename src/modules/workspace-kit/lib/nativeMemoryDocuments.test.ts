import { expect, it, vi } from "vitest";
import cases from "@/../templates/workspace-kit/conformance/document-paths.json";
import { isMemoryDocumentPath } from "@/modules/workspace-kit/lib/memoryDocumentPaths";
import {
  loadMemoryDocuments,
  parseMemoryDocuments,
} from "@/modules/workspace-kit/lib/nativeMemoryDocuments";

const snapshot = () => ({
  schema: 1,
  root: "/project",
  complete: true,
  blockedCount: 0,
  files: [
    {
      path: ".voktty/PROJECT.md",
      fact: { kind: "file", text: "café\r\n<script>literal</script>" },
    },
  ],
});

it.each(cases)("shared document path: $path", ({ path, valid }) => {
  expect(isMemoryDocumentPath(path)).toBe(valid);
});
it("retains exact text in immutable copies without turning it into instructions", () => {
  const value = snapshot();
  const parsed = parseMemoryDocuments(value, "/project");
  value.files[0].fact.text = "changed";
  expect(parsed.files[0].fact).toEqual({
    kind: "file",
    text: "café\r\n<script>literal</script>",
  });
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.files)).toBe(true);
  expect(Object.isFrozen(parsed.files[0].fact)).toBe(true);
});
it("rejects another root, reserved paths, duplicate files and impossible states", () => {
  const file = snapshot().files[0];
  for (const value of [
    null,
    [],
    { ...snapshot(), schema: 2 },
    { ...snapshot(), root: "/other" },
    { ...snapshot(), root: "/project\n" },
    { ...snapshot(), instructions: "untrusted" },
    { ...snapshot(), blockedCount: -1 },
    { ...snapshot(), blockedCount: 0.5 },
    { ...snapshot(), blockedCount: 1 },
    { ...snapshot(), complete: "yes" },
    { ...snapshot(), files: [file, file] },
    {
      ...snapshot(),
      files: [{ ...file, path: ".voktty/sessions/private.md" }],
    },
    {
      ...snapshot(),
      files: [{ ...file, fact: { kind: "file", text: "\ud800" } }],
    },
    {
      ...snapshot(),
      files: [{ ...file, fact: { kind: "absent", text: "private" } }],
    },
    { ...snapshot(), files: [{ ...file, fact: { kind: "blocked" } }] },
    {
      ...snapshot(),
      files: [{ ...file, fact: { kind: "file", text: "é".repeat(131073) } }],
    },
  ])
    expect(() => parseMemoryDocuments(value, "/project")).toThrow();
  expect(isMemoryDocumentPath(".voktty/plans/\ud800.md")).toBe(false);
});
it("enforces total text and wire budgets and accepts honest partial results", () => {
  const files = Array.from({ length: 9 }, (_, i) => ({
    path: `.voktty/plans/${i}.md`,
    fact: { kind: "file", text: "x".repeat(256 * 1024) },
  }));
  expect(() =>
    parseMemoryDocuments({ ...snapshot(), files }, "/project"),
  ).toThrow();
  expect(() =>
    parseMemoryDocuments(
      {
        ...snapshot(),
        files: files
          .slice(0, 8)
          .map((f) => ({
            ...f,
            fact: { kind: "file", text: "\u0000".repeat(256 * 1024) },
          })),
      },
      "/project",
    ),
  ).toThrow();
  expect(() =>
    parseMemoryDocuments(
      {
        ...snapshot(),
        files: Array.from({ length: 129 }, (_, i) => ({
          path: `.voktty/plans/${i}.md`,
          fact: { kind: "absent" },
        })),
      },
      "/project",
    ),
  ).toThrow();
  expect(
    parseMemoryDocuments(
      {
        ...snapshot(),
        complete: false,
        blockedCount: 1,
        files: [
          { path: ".voktty/plans/blocked.md", fact: { kind: "blocked" } },
        ],
      },
      "/project",
    ).complete,
  ).toBe(false);
});
it("holds the shared read capacity through actual settlement and releases rejected requests", async () => {
  let resolve!: (value: unknown) => void;
  const result = new Promise<unknown>((yes) => {
    resolve = yes;
  });
  const jobs = Array.from({ length: 256 }, () =>
    loadMemoryDocuments("/project", () => result),
  );
  const load = vi.fn(async () => snapshot());
  await expect(loadMemoryDocuments("/project", load)).rejects.toMatchObject({
    code: "busy",
  });
  expect(load).not.toHaveBeenCalled();
  resolve(snapshot());
  await Promise.all(jobs);
  await expect(
    loadMemoryDocuments("/project", async () => {
      throw new Error("fixture");
    }),
  ).rejects.toThrow("fixture");
  await expect(loadMemoryDocuments("/project", load)).resolves.toMatchObject({
    root: "/project",
  });
});
