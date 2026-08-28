import { MODELS } from "../config";

type ModelDisplayInfo = {
  id: string;
  hint: string;
  description: string;
};

type Translate = (key: string) => string;

const BUILTIN_MODEL_IDS = new Set<string>(MODELS.map((model) => model.id));

const MODEL_HINT_KEYS: Record<string, string> = {
  Flagship: "flagship",
  Balanced: "balanced",
  Fast: "fast",
  Max: "max",
  Fastest: "fastest",
  Coding: "coding",
  Cheap: "cheap",
  Frontier: "frontier",
  Best: "best",
  Previous: "previous",
  Legacy: "legacy",
  Lite: "lite",
  Stable: "stable",
  Reasoning: "reasoning",
  Configurable: "configurable",
  Local: "local",
  Code: "code",
  "Ultra-fast": "ultraFast",
  Versatile: "versatile",
  Thinking: "thinking",
};

function modelTranslationId(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9]+/g, "_");
}

export function getLocalizedModelDescription(
  model: ModelDisplayInfo | null | undefined,
  t: Translate,
): string {
  if (!model?.id) return "";
  if (!BUILTIN_MODEL_IDS.has(model.id)) return model.description ?? "";
  return t(
    `settings.models.modelDescriptions.${modelTranslationId(model.id)}`,
  );
}

export function getLocalizedModelHint(
  model: ModelDisplayInfo | null | undefined,
  t: Translate,
): string {
  if (!model?.id) return "";
  if (!BUILTIN_MODEL_IDS.has(model.id)) return model.hint ?? "";
  const key = model.hint ? MODEL_HINT_KEYS[model.hint] : undefined;
  return key ? t(`settings.models.hints.${key}`) : (model.hint ?? "");
}
