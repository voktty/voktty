import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickModelSelector } from "./QuickModelSelector";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
  type AgentModel,
} from "@/modules/harness/lib/models";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

const claude: AgentModel = {
  id: "test-claude",
  name: "Test Claude",
  harness: "claude",
  settings: [
    {
      id: "effort",
      label: "Effort",
      kind: "select",
      value: "low",
      options: [
        { label: "Low", value: "low" },
        { label: "High", value: "high" },
      ],
    },
    {
      id: "fast",
      label: "Fast",
      kind: "toggle",
      value: "false",
      options: [
        { label: "Off", value: "false" },
        { label: "On", value: "true" },
      ],
    },
  ],
};

const grok: AgentModel = {
  id: "test-grok",
  name: "Test Grok",
  harness: "grok",
};

describe("QuickModelSelector", () => {
  beforeEach(() => {
    resetHarnessModelOverlays();
    setHarnessModels("claude", [claude]);
    setHarnessModels("grok", [grok]);
  });

  it("renders provider tabs and model lists", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickModelSelector, {
        model: claude,
        values: { effort: "low" },
        availableHarnesses: ["claude", "grok"],
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-label="Search models"');
    expect(markup).toContain("Test Claude");
  });

  it("renders model reasoning effort and toggle controls when model supports them", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickModelSelector, {
        model: claude,
        values: { effort: "low", fast: "true" },
        availableHarnesses: ["claude"],
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('input type="range"');
    expect(markup).toContain('aria-label="Fast mode"');
  });
});
