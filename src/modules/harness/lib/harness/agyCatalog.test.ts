import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execChild: vi.fn(async () => ""),
  resolveGeminiBinary: vi.fn(async () => ({ path: "/fake/gemini" })),
}));

vi.mock("../fs", () => ({ homeDir: vi.fn(async () => "/home/test") }));

vi.mock("./child", () => ({
  execChild: mocks.execChild,
  resolveGeminiBinary: mocks.resolveGeminiBinary,
}));

import {
  AGY_MODEL_CATALOG,
  agyModelForEffort,
  discoverAgyModels,
} from "./agyCatalog";

beforeEach(() => {
  vi.clearAllMocks();
});

it("maps deprecated Gemini 3.7 entries from the CLI to Gemini 3.8", async () => {
  mocks.execChild.mockResolvedValue(
    [
      "gemini-3.7-flash-high\tGemini 3.7 Flash (High)",
      "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
    ].join("\n"),
  );

  const models = await discoverAgyModels("/workspace");

  expect(models).toEqual([
    {
      id: "gemini:gemini-3.8-flash-high",
      harness: "gemini",
      name: "Gemini 3.8 Flash (High)",
      nativeId: "gemini-3.8-flash-high",
    },
  ]);
});

it("folds per-level CLI entries into one model with an effort", async () => {
  // Output of `agy models` on 2026-11-11.
  mocks.execChild.mockResolvedValue(
    [
      "Fetching available models...",
      "gemini-3.8-flash-high	Gemini 3.8 Flash (High)",
      "gemini-3.8-flash-medium	Gemini 3.8 Flash (Medium)",
      "gemini-3.8-flash-low	Gemini 3.8 Flash (Low)",
      "claude-sonnet-4-6	Claude Sonnet 4.6 (Thinking)",
      "claude-opus-4-6-thinking	Claude Opus 4.6 (Thinking)",
      "gpt-oss-120b-medium	GPT-OSS 120B (Medium)",
    ].join("\n"),
  );

  const models = await discoverAgyModels("/workspace");

  expect(models.map((model) => model.name)).toEqual([
    "Gemini 3.8 Flash",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)",
  ]);
  const flash = models[0];
  expect(flash?.nativeId).toBe("gemini-3.8-flash-high");
  expect(flash?.settings?.[0]?.options.map((option) => option.value)).toEqual([
    "high",
    "medium",
    "low",
  ]);
});

it("runs a folded model as the level picked, and only a level it offers", () => {
  const offered = ["high", "medium", "low"];
  expect(agyModelForEffort("gemini-3.8-flash-high", "low", offered)).toBe(
    "gemini-3.8-flash-low",
  );
  expect(agyModelForEffort("gemini-3.8-flash-high", "max", offered)).toBe(
    "gemini-3.8-flash-high",
  );
  // A stale effort from another model never rewrites a lone entry.
  expect(agyModelForEffort("gpt-oss-120b-medium", "low", [])).toBe(
    "gpt-oss-120b-medium",
  );
});

it("keeps deprecated Gemini 3.7 out of the startup catalog", () => {
  expect(AGY_MODEL_CATALOG.map((model) => model.id)).not.toContain(
    "gemini:gemini-3.7-flash",
  );
});
