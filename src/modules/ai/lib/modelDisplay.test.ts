import { describe, expect, it } from "vitest";
import { MODELS } from "../config";
import { en } from "@/modules/i18n/locales/en";
import {
  getLocalizedModelDescription,
  getLocalizedModelHint,
} from "./modelDisplay";

const descriptions = en.settings.models.modelDescriptions as Record<
  string,
  string
>;

/** Mirrors the key the runtime builds, so a drift here fails the same way. */
const translationId = (modelId: string) =>
  modelId.replace(/[^a-zA-Z0-9]+/g, "_");

/**
 * The description key is built at runtime from the model id, so
 * `check:i18n-keys` cannot see it: it only resolves static keys. A missing
 * entry therefore ships silently and the picker renders the raw key, which is
 * exactly what happened to the local agent models.
 */
describe("built-in model descriptions", () => {
  it.each(MODELS.map((model) => model.id))(
    "has an English description for %s",
    (modelId) => {
      expect(descriptions[translationId(modelId)]).toBeTypeOf("string");
      expect(descriptions[translationId(modelId)]).not.toBe("");
    },
  );

  it("never renders a raw key for a built-in model", () => {
    const translate = (key: string) => {
      const leaf = key.split(".").pop() ?? key;
      return descriptions[leaf] ?? key;
    };
    for (const model of MODELS) {
      const text = getLocalizedModelDescription(
        { id: model.id, hint: model.hint, description: model.description },
        translate,
      );
      expect(text.startsWith("settings.models.")).toBe(false);
    }
  });

  it("falls back to the model's own text for an unknown id", () => {
    const passthrough = (key: string) => key;
    expect(
      getLocalizedModelDescription(
        { id: "custom-endpoint", hint: "", description: "My endpoint" },
        passthrough,
      ),
    ).toBe("My endpoint");
  });

  it("keeps an unmapped hint rather than emitting a key", () => {
    // "Local OAuth" has no entry in MODEL_HINT_KEYS and must survive as text.
    expect(
      getLocalizedModelHint(
        { id: "harness-claude", hint: "Local OAuth", description: "" },
        (key) => key,
      ),
    ).toBe("Local OAuth");
  });
});
