import type {
  AutocompleteProviderId,
  CompletionProtocolProfile,
} from "@/modules/ai/config";
import type { CompletionRuntimeCapabilities } from "./capabilities";

type OptionValue =
  | string
  | number
  | boolean
  | null
  | OptionValue[]
  | { [key: string]: OptionValue };

export type CompletionProviderOptions = Record<
  string,
  Record<string, OptionValue>
>;

export type CompletionAttempt = {
  maxOutputTokens: number;
  providerOptions?: CompletionProviderOptions;
};

export type CompletionPlan = {
  profile: Exclude<CompletionProtocolProfile, "auto">;
  attempts: CompletionAttempt[];
};

export type { CompletionProtocolProfile };

type CompletionPlanInput = {
  provider: AutocompleteProviderId;
  modelId: string;
  declaredReasoning: boolean;
  profileOverride?: CompletionProtocolProfile;
  capabilities?: CompletionRuntimeCapabilities | null;
};

const REASONING_MODEL =
  /(?:deepseek[-_:]?r1|gpt[-_:]?oss|qwen[-_:]?3|qwq|reason(?:er|ing))/i;

function inferredProfile(
  provider: AutocompleteProviderId,
  modelId: string,
): Exclude<CompletionProtocolProfile, "auto"> {
  if (provider === "deepseek") return "deepseek";
  if (provider === "ollama") return "ollama";
  if (provider === "lmstudio") return "lmstudio";
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai-compatible") {
    if (/deepseek/i.test(modelId)) return "deepseek";
    if (/ollama/i.test(modelId)) return "ollama";
    if (/lm[-_ ]?studio/i.test(modelId)) return "lmstudio";
    return "generic";
  }
  return "native";
}

function options(
  namespace: string,
  value: Record<string, OptionValue>,
): CompletionProviderOptions {
  return { [namespace]: value };
}

export function buildCompletionPlan(
  input: CompletionPlanInput,
): CompletionPlan {
  const profile =
    input.profileOverride && input.profileOverride !== "auto"
      ? input.profileOverride
      : inferredProfile(input.provider, input.modelId);
  const reasoning =
    input.declaredReasoning ||
    input.capabilities?.reasoning.supported === true ||
    REASONING_MODEL.test(input.modelId);
  const namespace = input.provider;

  if (profile === "deepseek") {
    return {
      profile,
      attempts: [
        {
          maxOutputTokens: 128,
          providerOptions: options(namespace, {
            thinking: { type: "disabled" },
          }),
        },
        { maxOutputTokens: 512 },
      ],
    };
  }

  if (!reasoning) {
    return {
      profile,
      attempts: [{ maxOutputTokens: 128 }, { maxOutputTokens: 128 }],
    };
  }

  if (profile === "ollama") {
    const allowed = input.capabilities?.reasoning.allowed ?? [];
    const canDisable = allowed.length === 0 || allowed.includes("off");
    const canUseLow = allowed.length === 0 || allowed.includes("low");
    const attempts: CompletionAttempt[] = [];
    if (canDisable) {
      attempts.push({
        maxOutputTokens: 128,
        providerOptions: options(namespace, { reasoningEffort: "none" }),
      });
    }
    if (canUseLow) {
      attempts.push({
        maxOutputTokens: 512,
        providerOptions: options(namespace, { reasoningEffort: "low" }),
      });
    }
    if (attempts.length === 0) attempts.push({ maxOutputTokens: 1024 });
    return { profile, attempts: attempts.slice(0, 2) };
  }

  if (profile === "lmstudio") {
    const allowed = input.capabilities?.reasoning.allowed ?? [];
    const canDisable = allowed.length === 0 || allowed.includes("off");
    return {
      profile,
      attempts: canDisable
        ? [
            {
              maxOutputTokens: 128,
              providerOptions: options(namespace, {
                reasoningEffort: "none",
              }),
            },
            { maxOutputTokens: 512 },
          ]
        : [{ maxOutputTokens: 1024 }],
    };
  }

  if (profile === "openai") {
    return {
      profile,
      attempts: [
        {
          maxOutputTokens: 512,
          providerOptions: options(namespace, { reasoningEffort: "low" }),
        },
        { maxOutputTokens: 1024 },
      ],
    };
  }

  if (profile === "anthropic") {
    return {
      profile,
      attempts: [
        {
          maxOutputTokens: 512,
          providerOptions: options(namespace, { effort: "low" }),
        },
        { maxOutputTokens: 1024 },
      ],
    };
  }

  const nativeOption =
    input.provider === "cerebras" ||
    input.provider === "groq" ||
    input.provider === "xai"
      ? options(namespace, { reasoningEffort: "low" })
      : undefined;
  return {
    profile,
    attempts: [
      {
        maxOutputTokens: nativeOption ? 512 : 1024,
        ...(nativeOption ? { providerOptions: nativeOption } : {}),
      },
      { maxOutputTokens: 1024 },
    ],
  };
}
