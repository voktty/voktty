import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HarnessId } from "./session";
import {
  loadLastModelSettings,
  mergeModelSettings,
  modelPickerTabs,
  preferredModelSettings,
  saveLastModelSettings,
  stepModelPickerTab,
  type AgentModel,
} from "./models";

const opus: AgentModel = {
  id: "claude:opus-5",
  harness: "claude",
  name: "Opus 5",
  settings: [
    {
      id: "effort",
      label: "Reasoning",
      kind: "select",
      value: "high",
      options: [
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
        { value: "max", label: "Max" },
      ],
    },
    {
      id: "fast",
      label: "Fast",
      kind: "toggle",
      value: "false",
      options: [
        { value: "true", label: "On" },
        { value: "false", label: "Off" },
      ],
    },
  ],
};

const haiku: AgentModel = {
  id: "claude:haiku-4.5",
  harness: "claude",
  name: "Haiku 4.5",
  settings: [
    {
      id: "thinking",
      label: "Thinking",
      kind: "toggle",
      value: "false",
      options: [
        { value: "true", label: "On" },
        { value: "false", label: "Off" },
      ],
    },
  ],
};

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("model settings memory", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    mockLocalStorage();
  });

  it("keeps valid current values when merging onto a model", () => {
    expect(
      mergeModelSettings(opus, { effort: "xhigh", fast: "true" }),
    ).toEqual({ effort: "xhigh", fast: "true" });
  });

  it("drops values the new model does not support", () => {
    expect(
      mergeModelSettings(haiku, { effort: "xhigh", fast: "true" }),
    ).toEqual({ thinking: "false" });
  });

  it("maps extra-high onto Claude's xhigh", () => {
    expect(mergeModelSettings(opus, { effort: "extra-high" })).toEqual({
      effort: "xhigh",
      fast: "false",
    });
  });

  it("remembers extra-high and fast across models that support them", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    expect(preferredModelSettings(opus)).toEqual({
      effort: "xhigh",
      fast: "true",
    });
    expect(preferredModelSettings(haiku)).toEqual({ thinking: "false" });
  });

  it("merges newly saved settings into previously stored ones", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    saveLastModelSettings({ thinking: "true" });
    expect(loadLastModelSettings()).toEqual({
      effort: "xhigh",
      fast: "true",
      thinking: "true",
    });
  });

  it("applies stored preferences over a session's current values", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    expect(preferredModelSettings(opus, { effort: "high", fast: "false" })).toEqual({
      effort: "xhigh",
      fast: "true",
    });
  });

  it("fill mode keeps stored preferences when the session still has defaults", () => {
    saveLastModelSettings({ effort: "xhigh", fast: "true" });
    saveLastModelSettings({ effort: "high", fast: "false" }, "fill");
    expect(loadLastModelSettings()).toEqual({
      effort: "xhigh",
      fast: "true",
    });
  });

  it("fill mode records session values that have not been stored yet", () => {
    saveLastModelSettings({ effort: "xhigh" }, "fill");
    expect(loadLastModelSettings()).toEqual({ effort: "xhigh" });
  });

  it("uses the current session when nothing has been stored yet", () => {
    expect(
      preferredModelSettings(opus, { effort: "xhigh", fast: "true" }),
    ).toEqual({ effort: "xhigh", fast: "true" });
  });
});

describe("model picker tabs", () => {
  const available = (id: HarnessId) =>
    id === "claude" || id === "fx" || id === "cursor";

  it("starts with favorites then installed providers", () => {
    expect(modelPickerTabs(available)).toEqual([
      "favorites",
      "claude",
      "cursor",
      "fx",
    ]);
  });

  it("wraps left and right across favorites and providers", () => {
    expect(stepModelPickerTab("favorites", 1, available)).toBe("claude");
    expect(stepModelPickerTab("claude", 1, available)).toBe("cursor");
    expect(stepModelPickerTab("fx", 1, available)).toBe("favorites");
    expect(stepModelPickerTab("favorites", -1, available)).toBe("fx");
  });

  it("treats an unavailable current tab as the start of the list", () => {
    expect(stepModelPickerTab("pi", 1, available)).toBe("claude");
  });
});
