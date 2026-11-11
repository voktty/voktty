import { homeDir } from "../fs";
import {
  type AgentModel,
  type ModelSetting,
  setHarnessModels,
} from "../models";
import { execChild, resolveGeminiBinary } from "./child";

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
    id: "gemini:gemini-3.8-flash",
    harness: "gemini",
    name: "Gemini 3.8 Flash",
    nativeId: "gemini-3.8-flash-high",
    settings: [REASONING_EFFORT_HIGH],
  },
  {
    id: "gemini:gemini-3.5-flash-lite",
    harness: "gemini",
    name: "Gemini 3.5 Flash-Lite",
    nativeId: "gemini-3.5-flash-lite",
  },
  {
    id: "gemini:gemini-3.6-flash",
    harness: "gemini",
    name: "Gemini 3.6 Flash",
    nativeId: "gemini-3.6-flash-medium",
    settings: [REASONING_EFFORT_MEDIUM],
  },
  {
    id: "gemini:gemini-3.1-pro-preview",
    harness: "gemini",
    name: "Gemini 3.1 Pro Preview",
    nativeId: "gemini-3.1-pro-preview-low",
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

export async function discoverAgyModels(
  projectCwd?: string,
): Promise<AgentModel[]> {
  try {
    const [{ path }, cwd] = await Promise.all([
      resolveGeminiBinary(),
      projectCwd ?? homeDir(),
    ]);
    const raw = await execChild(path, ["models"], cwd);
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: AgentModel[] = [];
    for (const line of lines) {
      if (line.startsWith("Fetching")) continue;
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const nativeId = parts[0].trim();
        const label = parts[1].trim();
        const currentNativeId = nativeId.replace(
          /^gemini-3\.7-flash(?=$|-)/,
          "gemini-3.8-flash",
        );
        const currentLabel =
          currentNativeId === nativeId ? label : label.replace("3.7", "3.8");
        const id = `gemini:${currentNativeId}`;
        const model: AgentModel = {
          id,
          harness: "gemini",
          name: currentLabel,
          nativeId: currentNativeId,
        };
        const existingIndex = parsed.findIndex((entry) => entry.id === id);
        if (existingIndex === -1) parsed.push(model);
        else parsed[existingIndex] = model;
      }
    }
    return parsed.length > 0 ? groupEffortVariants(parsed) : AGY_MODEL_CATALOG;
  } catch {
    return AGY_MODEL_CATALOG;
  }
}

const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const LEVEL_LABEL: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};
const VARIANT = new RegExp(`^(.+)-(${EFFORT_LEVELS.join("|")})$`);

/**
 * The CLI lists one model per reasoning level (`gemini-3.8-flash-high`,
 * `-medium`, `-low`). Those are one model with an effort, not three
 * models: fold them, defaulting to high when it exists. A lone suffixed
 * entry (`gpt-oss-120b-medium`) stays as it is.
 */
export function groupEffortVariants(models: AgentModel[]): AgentModel[] {
  const groups = new Map<string, AgentModel[]>();
  for (const model of models) {
    const base = VARIANT.exec(model.nativeId ?? "")?.[1];
    if (!base) continue;
    groups.set(base, [...(groups.get(base) ?? []), model]);
  }
  const out: AgentModel[] = [];
  const emitted = new Set<string>();
  for (const model of models) {
    const match = VARIANT.exec(model.nativeId ?? "");
    const group = match ? groups.get(match[1]) : undefined;
    if (!match || !group || group.length < 2) {
      out.push(model);
      continue;
    }
    const base = match[1];
    if (emitted.has(base)) continue;
    emitted.add(base);
    const levels = group
      .map((entry) => VARIANT.exec(entry.nativeId ?? "")?.[2] ?? "")
      .sort(
        (a, b) =>
          EFFORT_LEVELS.indexOf(b as (typeof EFFORT_LEVELS)[number]) -
          EFFORT_LEVELS.indexOf(a as (typeof EFFORT_LEVELS)[number]),
      );
    const preferred = levels.includes("high") ? "high" : levels[0];
    out.push({
      id: `gemini:${base}`,
      harness: "gemini",
      name: model.name.replace(/\s*\([^)]*\)\s*$/, ""),
      nativeId: `${base}-${preferred}`,
      settings: [
        {
          id: "effort",
          label: "Reasoning Effort",
          kind: "select",
          value: preferred,
          options: levels.map((level) => ({
            value: level,
            label: LEVEL_LABEL[level] ?? level,
          })),
        },
      ],
    });
  }
  return out;
}

/** The variant of a grouped model that carries the chosen effort. */
export function agyModelForEffort(
  nativeId: string,
  effort: string | undefined,
  offered: readonly string[],
): string {
  if (!effort || !offered.includes(effort)) return nativeId;
  const match = VARIANT.exec(nativeId);
  return match ? `${match[1]}-${effort}` : nativeId;
}
