import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";
import { saveRecentModelChoice, loadRecentModelChoices } from "../lib/models";

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
    writable: true,
  });
}

beforeEach(() => {
  mockLocalStorage();
});

afterEach(() => {
  localStorage.clear();
});

describe("ModelPicker", () => {
  it("renders trigger button with current model name and aria attributes", () => {
    const html = renderToStaticMarkup(
      createElement(ModelPicker, {
        harness: "grok",
        model: "grok:grok-4.6",
        values: { effort: "high" },
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
      }),
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Grok Build Grok 4.6"');
    expect(html).toContain("Grok 4.6");
    expect(html).toContain("Recent models: right-click");
  });

  it("renders with claude model name and harness icon", () => {
    const html = renderToStaticMarkup(
      createElement(ModelPicker, {
        harness: "claude",
        model: "claude:opus-5",
        values: { effort: "xhigh" },
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
      }),
    );

    expect(html).toContain("Claude Opus 5");
    expect(html).toContain('aria-label="Claude Code Claude Opus 5"');
  });

  it("integrates recent model choice persistence", () => {
    saveRecentModelChoice("claude", "claude:opus-5");
    saveRecentModelChoice("cursor", "cursor:composer-2.5");
    const recents = loadRecentModelChoices();
    expect(recents).toEqual([
      { harness: "cursor", model: "cursor:composer-2.5" },
      { harness: "claude", model: "claude:opus-5" },
    ]);
  });
});
