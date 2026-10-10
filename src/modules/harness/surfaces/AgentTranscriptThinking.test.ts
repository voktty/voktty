// @vitest-environment happy-dom

import type { Block } from "@/modules/harness/lib/session";
import { AgentTranscript } from "@/modules/harness/surfaces/AgentTranscript";
import { loadLocale, t } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/modules/harness/hooks/useTranscriptZen", () => ({
  useTranscriptZen: () => true,
}));

let container: HTMLDivElement;
let root: Root;
let previousLanguage: ReturnType<
  typeof usePreferencesStore.getState
>["language"];

beforeEach(() => {
  previousLanguage = usePreferencesStore.getState().language;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  usePreferencesStore.setState({ language: previousLanguage });
  vi.unstubAllGlobals();
});

it.each([
  ["en", "Thinking..."],
  ["es", "Pensando..."],
] as const)(
  "does not repeat an opened thought's summary in %s",
  async (language, label) => {
    await loadLocale(language);
    usePreferencesStore.setState({ language });
    const firstParagraph = "Check the config first.";
    const blocks: Block[] = [
      {
        id: "thought",
        role: "reasoning",
        text: `${firstParagraph}\n\nThen run the tests.`,
      },
      {
        id: "tool",
        role: "tool",
        text: "Run tests",
        tool: { kind: "shell", status: "completed" },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );
    const row = container.querySelector<HTMLButtonElement>(
      '[aria-label="' +
        t("harness.chrome.showThinking", { text: firstParagraph }) +
        '"]',
    );
    expect(row?.textContent).toBe(firstParagraph);
    expect(container.textContent).not.toContain("Then run the tests.");

    act(() => row?.click());
    expect(row?.getAttribute("aria-label")).toBe(
      t("harness.chrome.hideThinking"),
    );
    expect(row?.getAttribute("aria-expanded")).toBe("true");
    expect(row?.textContent).toBe(label);
    expect(container.textContent?.split(firstParagraph)).toHaveLength(2);
    expect(container.textContent).toContain("Then run the tests.");

    act(() => row?.click());
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(row?.textContent).toBe(firstParagraph);
    expect(container.textContent).not.toContain("Then run the tests.");
  },
);
