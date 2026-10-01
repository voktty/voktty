import { afterEach, beforeEach, expect, it } from "vitest";
import {
  defaultModelId,
  loadLastModelChoice,
  resetHarnessModelOverlays,
  saveLastModelChoice,
  savePickerProviderVisible,
  setHarnessModels,
} from "@/modules/harness/lib/models";
import { initialQuickChoice, resolveQuickModel } from "./quickComposer";

const storage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  resetHarnessModelOverlays();
});
afterEach(() => resetHarnessModelOverlays());

it("uses the configured Codex default instead of the last quick-composer model", () => {
  localStorage.setItem("voktty.quickComposerHarness", "cursor");
  localStorage.setItem("voktty.quickComposerModel", "cursor:composer-2.5");
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-luna",
  });
});

it("rereads the Providers default when opening another quick session", () => {
  saveLastModelChoice("cursor", "cursor:composer-2.5");
  expect(initialQuickChoice().harness).toBe("cursor");
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-luna",
  });
});

it("preserves a live-only model until its provider catalog arrives", () => {
  saveLastModelChoice("codex", "codex:custom-live-model");
  const choice = initialQuickChoice();
  expect(resolveQuickModel(choice)).toBeNull();
  setHarnessModels("codex", [
    { id: "codex:other", name: "Another model", harness: "codex" },
    { id: "codex:custom-live-model", name: "Custom Live Model", harness: "codex" },
  ]);
  expect(resolveQuickModel(choice)?.id).toBe("codex:custom-live-model");
  expect(initialQuickChoice()).toEqual(choice);
});

it("uses an enabled provider while the configured default is hidden", () => {
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  savePickerProviderVisible("codex", false);
  expect(initialQuickChoice()).toEqual({
    harness: "claude",
    model: defaultModelId("claude"),
  });
  // Falling back must not overwrite the user's configured default.
  expect(loadLastModelChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-luna",
  });
  savePickerProviderVisible("codex", true);
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-luna",
  });
});
