import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/lock.json";
import previews from "@/../templates/workspace-kit/conformance/deployment.json";
import { prepareKitDeployment } from "@/modules/workspace-kit/lib/lock";
import { parseKitLock } from "@/modules/workspace-kit/lib/validation";
import { loadKitTemplate } from "@/modules/workspace-kit/lib/resources";
import {
  renderKitTemplate,
  type KitFile,
} from "@/modules/workspace-kit/lib/template";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";

it.each(corpus.parsing)("shares native lock validation for $name", (test) => {
  try {
    const lock = parseKitLock(test.text);
    expect(test.valid).toBe(true);
    expect(lock).toEqual(JSON.parse(test.text));
    expect(Object.isFrozen(lock.bases)).toBe(true);
    expect(lock.bases.every(Object.isFrozen)).toBe(true);
  } catch (error) {
    if (test.valid) throw error;
    expect(error).toHaveProperty("issues");
    const issues = (error as { issues: { path: unknown[]; message: string }[] })
      .issues;
    if (test.issue)
      expect(
        issues.some(
          (issue) => JSON.stringify(issue.path) === JSON.stringify(test.issue),
        ),
      ).toBe(true);
    if (test.customCode)
      expect(issues.some((issue) => issue.message === test.customCode)).toBe(
        true,
      );
  }
});

it.each(corpus.preparation)(
  "shares effective native hashes for $name",
  async (test) => {
    const preview = previews.cases.find(
      (entry) => entry.name === test.previewCase,
    );
    expect(preview).toBeDefined();
    if (!preview) return;
    const facts = new Map(Object.entries(preview.facts)) as Map<
      string,
      KitPathFact
    >;
    facts.set(".voktty/kit.lock.json", test.lockFact as KitPathFact);
    const result = await prepareKitDeployment(
      corpus.version,
      previews.files as readonly KitFile[],
      facts,
      preview.rootLinks,
    );
    expect(result.lock).toEqual(test.expectedLock);
    expect(
      result.entries.filter((entry) => entry.path !== ".voktty/kit.lock.json"),
    ).toEqual(preview.expected?.entries);
    expect(
      result.entries.find((entry) => entry.path === ".voktty/kit.lock.json") ??
        null,
    ).toEqual(test.expectedLockEntry);
    expect(result.canPublish).toBe(test.expectedCanPublish);
  },
);

it("records all real bases, uses migrated bytes and is stable on a repeated deployment", async () => {
  const template = await loadKitTemplate();
  const files = renderKitTemplate(template, {
    project_name: "Fixture",
    language: "en",
    created_at: "2026-10-28",
  });
  const facts = new Map<string, KitPathFact>(
    files.map((file) => [file.path, { kind: "absent" }]),
  );
  facts.set(".voktty/.gitignore", { kind: "file", text: "*\n" });
  facts.set(".voktty/kit.lock.json", { kind: "absent" });
  const first = await prepareKitDeployment(template.version, files, facts);
  expect(first.lock?.bases).toHaveLength(
    files.filter((file) => file.kind === "base").length,
  );
  for (const base of first.lock?.bases ?? []) {
    const entry = first.entries.find((entry) => entry.path === base.path);
    expect(base.sha256).toBe(
      createHash("sha256")
        .update(entry?.proposed ?? "missing")
        .digest("hex"),
    );
  }
  for (const entry of first.entries)
    facts.set(entry.path, { kind: "file", text: entry.proposed });
  const second = await prepareKitDeployment(template.version, files, facts);
  expect(second.entries.every((entry) => entry.action === "skip")).toBe(true);
  expect(second.lock).toEqual(first.lock);
});

it("hashes captured bytes even if its caller mutates inputs during the digest", async () => {
  const files: { path: string; kind: "base"; text: string }[] = [
    { path: ".voktty/CARD.md", kind: "base", text: "é 😀\r\n" },
  ];
  const facts = new Map<string, KitPathFact>([
    [files[0].path, { kind: "absent" }],
  ]);
  facts.set(".voktty/kit.lock.json", { kind: "absent" });
  const pending = prepareKitDeployment("1.1.0", files, facts);
  files[0].text = "Changed";
  files[0].path = ".voktty/OTHER.md";
  facts.clear();
  const result = await pending;
  expect(result.entries[0].proposed).toBe("é 😀\r\n");
  expect(result.lock?.bases).toEqual([
    {
      path: ".voktty/CARD.md",
      version: "1.1.0",
      sha256: createHash("sha256").update("é 😀\r\n").digest("hex"),
    },
  ]);
});

it("fails without a fake successful lock when the digest fails", async () => {
  const spy = vi
    .spyOn(crypto.subtle, "digest")
    .mockRejectedValueOnce(new Error("digest unavailable"));
  try {
    await expect(
      prepareKitDeployment(
        "1.1.0",
        [{ path: ".voktty/a", kind: "base", text: "a" }],
        new Map([
          [".voktty/a", { kind: "absent" }],
          [".voktty/kit.lock.json", { kind: "absent" }],
        ]),
      ),
    ).rejects.toThrow("digest unavailable");
  } finally {
    spy.mockRestore();
  }
});

it("bounds lock documents and preparation before hashing", async () => {
  expect(() => parseKitLock(" ".repeat(65537))).toThrow(
    "KIT_DOCUMENT_TOO_LARGE",
  );
  const files: KitFile[] = [
    { path: ".voktty/a", kind: "base", text: "x".repeat(262145) },
  ];
  await expect(prepareKitDeployment("1.1.0", files, new Map())).rejects.toThrow(
    "KIT_LOCK_INPUT_INVALID",
  );
  await expect(prepareKitDeployment("1.1.0\n", [], new Map())).rejects.toThrow(
    "KIT_LOCK_INPUT_INVALID",
  );
  await expect(
    prepareKitDeployment("1.1.0", [{ ...files[0], text: "\ud800" }], new Map()),
  ).rejects.toThrow("KIT_LOCK_INPUT_INVALID");
});

it("requires an observation for the record itself and refuses self-recording inputs", async () => {
  await expect(prepareKitDeployment("1.1.0", [], new Map())).rejects.toThrow(
    "Missing deployment observation",
  );
  const facts = new Map<string, KitPathFact>([
    [".voktty/kit.lock.json", { kind: "file", text: " ".repeat(65537) }],
  ]);
  await expect(prepareKitDeployment("1.1.0", [], facts)).rejects.toThrow(
    "KIT_LOCK_INPUT_INVALID",
  );
  await expect(
    prepareKitDeployment(
      "1.1.0",
      [{ path: ".voktty/kit.lock.json", kind: "base", text: "a" }],
      facts,
    ),
  ).rejects.toThrow("KIT_LOCK_INPUT_INVALID");
});

it("bounds aggregate sources and observed files before planning", async () => {
  const files: KitFile[] = Array.from({ length: 5 }, (_, index) => ({
    path: `.voktty/a${index}`,
    kind: "base",
    text: "a".repeat(256 * 1024),
  }));
  await expect(prepareKitDeployment("1.1.0", files, new Map())).rejects.toThrow(
    "KIT_LOCK_INPUT_INVALID",
  );
  const small = files.map((file) => ({ ...file, text: "a" }));
  const facts = new Map<string, KitPathFact>(
    files.map((file) => [file.path, { kind: "file", text: file.text }]),
  );
  await expect(prepareKitDeployment("1.1.0", small, facts)).rejects.toThrow(
    "KIT_LOCK_INPUT_INVALID",
  );
});

it("leaves unselected root observations out of preparation", async () => {
  const files: KitFile[] = [
    { path: "AGENTS.md", kind: "link", text: "Kit link\n" },
  ];
  const facts = new Map<string, KitPathFact>([
    ["AGENTS.md", { kind: "file", text: "a".repeat(300000) }],
    [".voktty/kit.lock.json", { kind: "absent" }],
  ]);
  expect((await prepareKitDeployment("1.1.0", files, facts)).canPublish).toBe(
    true,
  );
  await expect(
    prepareKitDeployment("1.1.0", files, facts, {
      agents: true,
      claude: false,
    }),
  ).rejects.toThrow("KIT_LOCK_INPUT_INVALID");
});
