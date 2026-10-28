import { beforeAll, expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/memory.json";
import {
  inspectMemoryText,
  measureMemory,
} from "@/modules/workspace-kit/lib/memory";
import { loadKitTemplate } from "@/modules/workspace-kit/lib/resources";
import { renderKitTemplate } from "@/modules/workspace-kit/lib/template";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";

let config: Record<string, unknown>;
beforeAll(async () => {
  const files = renderKitTemplate(await loadKitTemplate(), {
    project_name: "Fixture",
    language: "en",
    created_at: "2026-10-28",
  });
  config = JSON.parse(
    files.find((file) => file.path === ".voktty/kit.json")?.text ?? "missing",
  );
});

it.each(corpus.text)("shares native text inspection for $name", (test) => {
  expect(inspectMemoryText(test.text, test.heading)).toEqual(test.expected);
});

it.each(corpus.measurement)("shares native measurements for $name", (test) => {
  const text = JSON.stringify({ ...config, limits: test.limits });
  const documents = new Map(Object.entries(test.documents)) as Map<
    string,
    KitPathFact
  >;
  const inspect = () =>
    measureMemory(text, documents, test.handoffs, test.nowMs, test.heading);
  if (test.error) expect(inspect).toThrow(test.error);
  else expect(inspect()).toEqual(test.expected);
});

it("keeps every occurrence so an open reference cannot be closed by another mention", () => {
  const result = inspectMemoryText("[T-1 done]\n[T-1]");
  expect(result.ids.map((item) => item.state)).toEqual(["done", "open"]);
  expect(Object.isFrozen(result.ids[0])).toBe(true);
});

it("bounds text and inventories, and handles dense lists without argument spreading", () => {
  expect(() => inspectMemoryText("a".repeat(262145))).toThrow(
    "KIT_MEMORY_TEXT_TOO_LARGE",
  );
  expect(() => inspectMemoryText("\ud800")).toThrow("KIT_MEMORY_TEXT_INVALID");
  expect(() => inspectMemoryText("a", "\ud800")).toThrow(
    "KIT_MEMORY_TEXT_INVALID",
  );
  const text = `## Up next\n${"- a\n".repeat(60000)}`;
  expect(inspectMemoryText(text).upNext).toBe(60000);
  const limits = { "continuity/handoffs/": { maxFiles: 1, maxAgeDays: 1 } };
  expect(() =>
    measureMemory(
      JSON.stringify({ ...config, limits }),
      new Map(),
      {
        complete: true,
        files: Array.from({ length: 20001 }, () => ({
          name: "a.md",
          createdAtMs: 0,
        })),
      },
      0,
    ),
  ).toThrow("KIT_MEMORY_INVENTORY_TOO_LARGE");
});

it("accepts mathematically integral JSON numbers without changing the result", () => {
  const text = JSON.stringify({
    ...config,
    limits: { "CONTEXT.md": { maxChars: 2 } },
  }).replace('"maxChars":2', '"maxChars":2.0');
  expect(
    measureMemory(
      text,
      new Map([["CONTEXT.md", { kind: "file", text: "é😀" }]]),
      { complete: true, files: [] },
      0,
    ).measurements[0].status,
  ).toBe("ok");
});
