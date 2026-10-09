import { describe, expect, it } from "vitest";
import {
  flattenOpenCodeModels,
  parseV2Agents,
  parseV2Catalog,
} from "./opencodeCatalog";
import {
  assertSupportedOpenCodeVersion,
  sameDirectory,
  rememberBounded,
  rememberBoundedSet,
} from "./opencodeProtocol";
describe("sameDirectory", () => {
  it("ignores trailing separators and separator style", () => {
    expect(sameDirectory("/repo/", "/repo")).toBe(true);
    expect(sameDirectory("C:\\work\\repo\\", "C:/work/repo")).toBe(true);
    expect(sameDirectory("/repo", "/repo-old-worktree")).toBe(false);
  });
});

describe("rememberBounded", () => {
  it("drops the oldest entries past the limit", () => {
    const map = new Map<string, number>();
    const set = new Set<string>();
    for (const [index, key] of ["a", "b", "c"].entries()) {
      rememberBounded(map, key, index, 2);
      rememberBoundedSet(set, key, 2);
    }
    expect([...map.keys()]).toEqual(["b", "c"]);
    expect([...set]).toEqual(["b", "c"]);
  });
});

describe("OpenCode API versions", () => {
  it("selects the v1 and v2 API generations and rejects unknown majors", () => {
    expect(assertSupportedOpenCodeVersion("1.14.19")).toBe("v1");
    expect(assertSupportedOpenCodeVersion("2.0.15")).toBe("v2");
    expect(() => assertSupportedOpenCodeVersion("2.0.14")).toThrow(
      "Upgrade to v2.0.15",
    );
    expect(() => assertSupportedOpenCodeVersion("3.0.0")).toThrow(
      "Voktty supports OpenCode v1 and v2",
    );
  });
});
describe("OpenCode v2 catalog", () => {
  it("normalizes v2 API models, providers, variants, and agents", () => {
    const parsed = parseV2Catalog(
      [
        {
          id: "anthropic/claude-sonnet-4-6",
          modelID: "claude-sonnet-4-6",
          providerID: "anthropic",
          name: "Claude Sonnet 4.6",
          enabled: true,
          variants: [{ id: "low" }, { id: "high" }],
          limit: { context: 200_000, output: 64_000 },
        },
        {
          id: "disabled/model",
          modelID: "model",
          providerID: "disabled",
          name: "Disabled",
          enabled: false,
          variants: [],
          limit: { context: 1, output: 1 },
        },
      ],
      [{ id: "anthropic", name: "Anthropic API" }],
    );
    const agents = parseV2Agents([
      { id: "build", name: "Build", mode: "primary", hidden: false },
      { id: "title", name: "Title", mode: "primary", hidden: true },
    ]);
    expect(agents.map((agent) => agent.name)).toEqual(["build", "title"]);
    const models = flattenOpenCodeModels(parsed, agents);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      nativeId: "anthropic/claude-sonnet-4-6",
      provider: { id: "anthropic", name: "Anthropic API" },
      contextWindow: 200_000,
    });
    expect(
      models[0]?.settings?.find((setting) => setting.id === "variant"),
    ).toMatchObject({
      value: "high",
      options: [{ value: "low" }, { value: "high" }],
    });
    expect(
      models[0]?.settings?.find((setting) => setting.id === "agent"),
    ).toMatchObject({ value: "build", options: [{ value: "build" }] });
  });

  it("publishes the selectable v2 alias id over the upstream modelID", () => {
    const parsed = parseV2Catalog(
      [
        {
          id: "openai/coding",
          modelID: "gpt-5.2",
          providerID: "openai",
          name: "Coding",
          enabled: true,
          variants: [],
        },
        {
          id: "mimo-v2.6-flash-free",
          modelID: "mimo-v2.6-flash-free",
          providerID: "opencode",
          name: "MiMo",
          enabled: true,
          variants: [],
        },
      ],
      [
        { id: "openai", name: "OpenAI" },
        { id: "opencode", name: "OpenCode" },
      ],
    );
    const models = flattenOpenCodeModels(parsed, []);
    expect(models.map((model) => model.nativeId).sort()).toEqual([
      "openai/coding",
      "opencode/mimo-v2.6-flash-free",
    ]);
  });
});
