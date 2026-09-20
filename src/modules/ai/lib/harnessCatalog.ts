import type { HarnessId } from "@/modules/harness/lib/session";
import { modelsFor } from "@/modules/harness/lib/models";
import {
  harnessModelId,
  type ModelCapabilities,
  type ModelInfo,
  type ModelTag,
} from "../config";

/**
 * Turns the harness catalog into chat models.
 *
 * Offering one entry per agent could not say which model to run, so every
 * selection fell back to the cheap one the runners use for titles and commit
 * messages: picking "Claude" ran Haiku. Listing the agent's catalog lets the
 * selection name a model, and the runner is given it.
 */

type ExposedAgent = {
  /** Chat-side provider grouping, matching the harness ids in the catalog. */
  harness: HarnessId;
  /** Key under settings.models.modelDescriptions, shared with the agent row. */
  descriptionKey: string;
  capabilities: ModelCapabilities;
  tags: readonly ModelTag[];
};

const EXPOSED_AGENTS: readonly ExposedAgent[] = [
  {
    harness: "claude",
    descriptionKey: "harness_claude",
    capabilities: { intelligence: 5, speed: 4, cost: 5 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    harness: "codex",
    descriptionKey: "harness_codex",
    capabilities: { intelligence: 5, speed: 4, cost: 5 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    harness: "cursor",
    descriptionKey: "harness_agy",
    capabilities: { intelligence: 5, speed: 4, cost: 5 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    harness: "opencode",
    descriptionKey: "harness_opencode",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["tools", "coding"],
  },
  {
    harness: "grok",
    descriptionKey: "harness_grok",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["tools", "coding"],
  },
];

export const HARNESS_CHAT_HINT = "Local OAuth";

type Translate = (key: string) => string;

function toModelInfo(
  agent: ExposedAgent,
  model: { id: string; name: string },
  t: Translate,
): ModelInfo {
  return {
    id: harnessModelId(model.id),
    provider: "harness",
    label: model.name,
    hint: HARNESS_CHAT_HINT,
    description: t(`settings.models.modelDescriptions.${agent.descriptionKey}`),
    capabilities: agent.capabilities,
    tags: agent.tags,
  };
}

/** Every model the installed local agents can run, as chat models. */
export function harnessChatModels(t: Translate): ModelInfo[] {
  return EXPOSED_AGENTS.flatMap((agent) =>
    modelsFor(agent.harness).map((model) => toModelInfo(agent, model, t)),
  );
}

/** The chat model for one id, or null when no agent claims it. */
export function harnessChatModelInfo(
  modelId: string,
  t: Translate,
): ModelInfo | null {
  return harnessChatModels(t).find((model) => model.id === modelId) ?? null;
}
