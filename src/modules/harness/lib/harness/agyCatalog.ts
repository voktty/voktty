import { setHarnessModels, type AgentModel, type ModelSetting } from "../models";
import { execChild } from "./child";

const REASONING_EFFORT_HIGH: ModelSetting = {
  id: "effort",
  label: "Reasoning Effort",
  kind: "select",
  value: "high",
  options: [
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ],
};

const REASONING_EFFORT_MEDIUM: ModelSetting = {
  id: "effort",
  label: "Reasoning Effort",
  kind: "select",
  value: "medium",
  options: [
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ],
};

const REASONING_EFFORT_LOW: ModelSetting = {
  id: "effort",
  label: "Reasoning Effort",
  kind: "select",
  value: "low",
  options: [
    { value: "high", label: "High" },
    { value: "low", label: "Low" },
  ],
};

export const AGY_MODEL_CATALOG: AgentModel[] = [
  {
    id: "gemini:gemini-3.7-flash",
    harness: "gemini",
    name: "Gemini 3.7 Flash",
    nativeId: "gemini-3.7-flash-high",
    settings: [REASONING_EFFORT_HIGH],
  },
  {
    id: "gemini:gemini-3.6-flash",
    harness: "gemini",
    name: "Gemini 3.6 Flash",
    nativeId: "gemini-3.6-flash-medium",
    settings: [REASONING_EFFORT_MEDIUM],
  },
  {
    id: "gemini:gemini-3.1-pro",
    harness: "gemini",
    name: "Gemini 3.1 Pro",
    nativeId: "gemini-3.1-pro-low",
    settings: [REASONING_EFFORT_LOW],
  },
  {
    id: "gemini:claude-sonnet-4-6",
    harness: "gemini",
    name: "Claude Sonnet 4.6 (Thinking)",
    nativeId: "claude-sonnet-4-6",
  },
  {
    id: "gemini:claude-opus-4-6-thinking",
    harness: "gemini",
    name: "Claude Opus 4.6 (Thinking)",
    nativeId: "claude-opus-4-6-thinking",
  },
  {
    id: "gemini:gpt-oss-120b-medium",
    harness: "gemini",
    name: "GPT-OSS 120B (Medium)",
    nativeId: "gpt-oss-120b-medium",
  },
];

let inflight: Promise<void> | null = null;

export function refreshAgyCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = discoverAgyModels()
    .then((models) => {
      if (models.length > 0) setHarnessModels("gemini", models);
    })
    .catch((error: unknown) => {
      console.debug("[harness] agy catalog discovery", error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function discoverAgyModels(): Promise<AgentModel[]> {
  try {
    const raw = await execChild("agy", ["models"]);
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed: AgentModel[] = [];
    for (const line of lines) {
      if (line.startsWith("Fetching")) continue;
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const nativeId = parts[0].trim();
        const label = parts[1].trim();
        const id = `gemini:${nativeId}`;
        parsed.push({
          id,
          harness: "gemini",
          name: label,
          nativeId,
        });
      }
    }
    return parsed.length > 0 ? parsed : AGY_MODEL_CATALOG;
  } catch {
    return AGY_MODEL_CATALOG;
  }
}
