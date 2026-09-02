import { homeDir } from "../fs";
import {
  setHarnessModels,
  type AgentModel,
  type ModelSetting,
} from "../models";
import { execChild, resolveClaudeBinary } from "./child";
import {
  compareSemver,
  MINIMUM_CLAUDE_FABLE_5_VERSION,
  MINIMUM_CLAUDE_OPUS_4_7_VERSION,
  MINIMUM_CLAUDE_OPUS_4_8_VERSION,
  MINIMUM_CLAUDE_OPUS_5_VERSION,
  parseClaudeVersion,
} from "./claudeProtocol";

const EFFORT_LOW_TO_ULTRATHINK: ModelSetting = {
  id: "effort",
  label: "Reasoning",
  kind: "select",
  value: "high",
  options: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "max", label: "Max" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
};

const EFFORT_WITH_XHIGH: ModelSetting = {
  id: "effort",
  label: "Reasoning",
  kind: "select",
  value: "high",
  options: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra High" },
    { value: "max", label: "Max" },
    {
      value: "ultracode",
      label: "Ultracode",
    },
    { value: "ultrathink", label: "Ultrathink" },
  ],
};

const EFFORT_OPUS_47: ModelSetting = {
  id: "effort",
  label: "Reasoning",
  kind: "select",
  value: "xhigh",
  options: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra High" },
    { value: "max", label: "Max" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
};

const FAST_MODE: ModelSetting = {
  id: "fast",
  label: "Fast",
  kind: "toggle",
  value: "false",
  options: [
    { value: "true", label: "On" },
    { value: "false", label: "Off" },
  ],
};

const THINKING: ModelSetting = {
  id: "thinking",
  label: "Thinking",
  kind: "toggle",
  value: "false",
  options: [
    { value: "true", label: "On" },
    { value: "false", label: "Off" },
  ],
};

function contextWindow(defaultValue: "200k" | "1m"): ModelSetting {
  return {
    id: "context",
    label: "Context",
    kind: "select",
    value: defaultValue,
    options: [
      { value: "200k", label: "200k" },
      { value: "1m", label: "1M" },
    ],
  };
}

/** Built-in Claude Code catalog. */
export const CLAUDE_MODEL_CATALOG: AgentModel[] = [
  {
    id: "claude:fable-5.1",
    harness: "claude",
    name: "Claude Fable 5.1",
    nativeId: "claude-fable-5.1",
    settings: [EFFORT_WITH_XHIGH, contextWindow("1m")],
  },
  {
    id: "claude:fable-5",
    harness: "claude",
    name: "Claude Fable 5",
    nativeId: "claude-fable-5",
    settings: [EFFORT_WITH_XHIGH, contextWindow("1m")],
  },
  {
    id: "claude:opus-5",
    harness: "claude",
    name: "Claude Opus 5",
    nativeId: "claude-opus-5",
    settings: [EFFORT_WITH_XHIGH, FAST_MODE, contextWindow("1m")],
  },
  {
    id: "claude:sonnet-5",
    harness: "claude",
    name: "Claude Sonnet 5",
    nativeId: "claude-sonnet-5",
    settings: [EFFORT_WITH_XHIGH, contextWindow("200k")],
  },
  {
    id: "claude:opus-4.8",
    harness: "claude",
    name: "Claude Opus 4.8",
    nativeId: "claude-opus-4-8",
    settings: [EFFORT_WITH_XHIGH, FAST_MODE],
  },
  {
    id: "claude:opus-4.7",
    harness: "claude",
    name: "Claude Opus 4.7",
    nativeId: "claude-opus-4-7",
    settings: [EFFORT_OPUS_47, FAST_MODE],
  },
  {
    id: "claude:opus-4.6",
    harness: "claude",
    name: "Claude Opus 4.6",
    nativeId: "claude-opus-4-6",
    settings: [EFFORT_LOW_TO_ULTRATHINK, FAST_MODE, contextWindow("1m")],
  },
  {
    id: "claude:sonnet-4.6",
    harness: "claude",
    name: "Claude Sonnet 4.6",
    nativeId: "claude-sonnet-4-6",
    settings: [EFFORT_LOW_TO_ULTRATHINK, contextWindow("200k")],
  },
  {
    id: "claude:opus-4.5",
    harness: "claude",
    name: "Claude Opus 4.5",
    nativeId: "claude-opus-4-5",
    settings: [
      {
        id: "effort",
        label: "Reasoning",
        kind: "select",
        value: "high",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "max", label: "Max" },
        ],
      },
      FAST_MODE,
    ],
  },
  {
    id: "claude:haiku-4.5",
    harness: "claude",
    name: "Claude Haiku 4.5",
    nativeId: "claude-haiku-4-5",
    settings: [THINKING],
  },
];

let inflight: Promise<void> | null = null;

export function refreshClaudeCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = discoverClaudeModels()
    .then((models) => {
      if (models.length > 0) setHarnessModels("claude", models);
    })
    .catch((error: unknown) => {
      console.debug("[monocode] claude catalog", error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function discoverClaudeModels(): Promise<AgentModel[]> {
  const { path } = await resolveClaudeBinary();
  const cwd = await homeDir();
  const versionOut = await execChild(path, ["--version"], cwd);
  const version = parseClaudeVersion(versionOut);
  return modelsForClaudeVersion(version);
}

export function modelsForClaudeVersion(
  version: string | null | undefined,
): AgentModel[] {
  return CLAUDE_MODEL_CATALOG.filter((model) => {
    const slug = model.nativeId ?? "";
    if (slug === "claude-opus-5") {
      return version
        ? compareSemver(version, MINIMUM_CLAUDE_OPUS_5_VERSION) >= 0
        : false;
    }
    if (slug === "claude-fable-5") {
      return version
        ? compareSemver(version, MINIMUM_CLAUDE_FABLE_5_VERSION) >= 0
        : false;
    }
    if (slug === "claude-opus-4-8") {
      return version
        ? compareSemver(version, MINIMUM_CLAUDE_OPUS_4_8_VERSION) >= 0
        : false;
    }
    if (slug === "claude-opus-4-7") {
      return version
        ? compareSemver(version, MINIMUM_CLAUDE_OPUS_4_7_VERSION) >= 0
        : false;
    }
    return true;
  });
}
