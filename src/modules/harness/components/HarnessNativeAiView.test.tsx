// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { compatModelIdForEndpoint } from "@/modules/ai/config";
import { HarnessNativeAiView } from "./HarnessNativeAiView";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  t: (key: string) => key,
}));
vi.mock("@/modules/ai/components/AiMiniWindow", () => ({
  AiChatBody: () => createElement("div", null, "Chat"),
}));
vi.mock("@/modules/ai/components/PlanDiffReview", () => ({
  PlanDiffReview: () => null,
}));
vi.mock("@/modules/ai/components/AiComposerInput", () => ({
  AiComposerInput: () => createElement("textarea"),
}));
vi.mock("@/modules/ai/lib/modelPrefs", () => ({
  pushRecentModel: vi.fn(),
  toggleFavoriteModel: vi.fn(),
}));
vi.mock("@/modules/ai/lib/composer", () => ({
  ACCEPTED_FILES: "",
  useComposer: () => ({
    files: [],
    pickedSnippets: [],
    pickedCommands: [],
    voice: { supported: false },
    isBusy: false,
    canSend: false,
  }),
}));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const preferences = usePreferencesStore.getState();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  usePreferencesStore.setState({
    aiEnabled: true,
    aiConfigRevision: 1,
    aiHealthRevision: 1,
    aiHealthCheckedAt: 1,
    ollamaModelId: "local-model",
    favoriteModelIds: [],
    recentModelIds: [],
    customEndpoints: [
      {
        id: "lan",
        name: "LAN",
        baseURL: "http://model.local/v1",
        modelId: "fcm",
        contextLimit: 8192,
      },
    ],
  });
  useChatStore.setState({
    activeSessionId: "test",
    selectedModelId: "ollama-local",
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  usePreferencesStore.setState(preferences);
  vi.unstubAllGlobals();
});
it("uses the existing model picker for configured Ollama and custom endpoint models", async () => {
  await act(async () => {
    root.render(createElement(HarnessNativeAiView, { onClose: vi.fn() }));
  });
  const trigger = container.querySelector<HTMLButtonElement>(
    "button[aria-haspopup='menu']",
  )!;
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
        ctrlKey: false,
      }),
    );
  });
  const entries = [
    ...document.querySelectorAll<HTMLElement>("[role='menuitem']"),
  ];
  const custom = entries.find((entry) => entry.textContent?.includes("fcm"));
  expect(custom).toBeDefined();
  expect(
    entries.some((entry) =>
      entry.textContent?.includes("settings.models.localProviderLabel.ollama"),
    ),
  ).toBe(true);
  await act(async () => {
    custom!.click();
  });
  expect(useChatStore.getState().selectedModelId).toBe(
    compatModelIdForEndpoint("lan"),
  );
  expect(container.querySelector("textarea")).not.toBeNull();
});
