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

import { AGY_MODEL_CATALOG, discoverAgyModels } from "./agyCatalog";

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

it("keeps deprecated Gemini 3.7 out of the startup catalog", () => {
  expect(AGY_MODEL_CATALOG.map((model) => model.id)).not.toContain(
    "gemini:gemini-3.7-flash",
  );
});
