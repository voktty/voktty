import { describe, expect, it } from "vitest";
import {
  agentModelIdFromHarnessModel,
  harnessIdFromModelId,
  harnessModelId,
  isCompatModelId,
  isHarnessModelId,
} from "../config";
import { harnessChatModelInfo, harnessChatModels } from "./harnessCatalog";

describe("local agent model ids", () => {
  it("round-trips a catalog id", () => {
    const id = harnessModelId("claude:opus-5");
    expect(isHarnessModelId(id)).toBe(true);
    expect(agentModelIdFromHarnessModel(id)).toBe("claude:opus-5");
  });

  it("recovers the agent without needing the catalog", () => {
    expect(harnessIdFromModelId(harnessModelId("claude:sonnet-5"))).toBe(
      "claude",
    );
    expect(harnessIdFromModelId(harnessModelId("codex:gpt-5.6-luna"))).toBe(
      "codex",
    );
    expect(harnessIdFromModelId(harnessModelId("cursor:composer-1"))).toBe(
      "cursor",
    );
  });

  it("tolerates a catalog id with no agent separator", () => {
    expect(harnessIdFromModelId(harnessModelId("opencode"))).toBe("opencode");
  });

  it("keeps a model id that carries extra colons intact", () => {
    // OpenCode slugs are provider/model pairs and can carry more separators.
    const id = harnessModelId("opencode:anthropic/claude-sonnet-5");
    expect(agentModelIdFromHarnessModel(id)).toBe(
      "opencode:anthropic/claude-sonnet-5",
    );
    expect(harnessIdFromModelId(id)).toBe("opencode");
  });

  it("rejects ids that belong to other providers", () => {
    expect(isHarnessModelId("gpt-5.4-mini")).toBe(false);
    expect(isHarnessModelId("compat-endpoint1")).toBe(false);
    expect(agentModelIdFromHarnessModel("gpt-5.4-mini")).toBe("");
    expect(harnessIdFromModelId("gpt-5.4-mini")).toBe("");
  });

  it("does not collide with the custom endpoint scheme", () => {
    const id = harnessModelId("claude:opus-5");
    expect(isCompatModelId(id)).toBe(false);
  });
});

describe("harnessChatModels", () => {
  const t = (key: string) => key;

  it("exposes each agent's catalog instead of one row per agent", () => {
    const models = harnessChatModels(t);
    expect(models.length).toBeGreaterThan(5);
    const labels = models.map((m) => m.label);
    expect(labels).toContain("Claude Sonnet 5");
    expect(labels).toContain("Claude Opus 5");
  });

  it("gives every entry the local agent provider and a usable id", () => {
    for (const model of harnessChatModels(t)) {
      expect(model.provider).toBe("harness");
      expect(isHarnessModelId(model.id)).toBe(true);
      expect(agentModelIdFromHarnessModel(model.id)).not.toBe("");
    }
  });

  it("covers the five agents the chat offers", () => {
    const agents = new Set(
      harnessChatModels(t).map((m) => harnessIdFromModelId(m.id)),
    );
    expect(agents).toEqual(
      new Set(["claude", "codex", "cursor", "opencode", "grok"]),
    );
  });

  it("emits no duplicate ids", () => {
    const ids = harnessChatModels(t).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves one entry by id and nothing for a foreign id", () => {
    const first = harnessChatModels(t)[0]!;
    expect(harnessChatModelInfo(first.id, t)?.label).toBe(first.label);
    expect(harnessChatModelInfo("gpt-5.4-mini", t)).toBeNull();
  });
});
