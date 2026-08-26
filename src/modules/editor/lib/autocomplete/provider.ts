import {
  type AutocompleteProviderId,
  DEFAULT_AUTOCOMPLETE_MODEL,
  LMSTUDIO_DEFAULT_BASE_URL,
  modelSupportsTemperature,
  modelUsesReasoningTokens,
} from "@/modules/ai/config";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { generateText } from "ai";
import {
  buildUserPrompt,
  COMPLETION_SYSTEM_PROMPT,
  type CompletionRequest,
} from "./prompt";
import {
  getCachedCompletionCapabilities,
  type CompletionRuntimeCapabilities,
} from "./capabilities";
import {
  buildCompletionPlan,
  type CompletionProtocolProfile,
} from "./profiles";

export type CompletionDeps = {
  provider: AutocompleteProviderId;
  modelId: string;
  apiKey: string | null;
  lmstudioBaseURL: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
  profileOverride?: CompletionProtocolProfile;
  capabilities?: CompletionRuntimeCapabilities | null;
};

export type CompletionErrorCode =
  | "authentication"
  | "rate_limit"
  | "unsupported_options"
  | "unavailable"
  | "empty_response"
  | "provider_error";

export class CompletionRequestError extends Error {
  constructor(
    readonly code: CompletionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CompletionRequestError";
  }
}

export type CompletionResult = {
  text: string;
  profile: Exclude<CompletionProtocolProfile, "auto">;
  attemptsUsed: number;
  latencyMs: number;
};

export function classifyCompletionError(error: unknown): CompletionErrorCode {
  if (error instanceof CompletionRequestError) return error.code;
  const status =
    error !== null && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    /api key|unauthori|forbidden/.test(normalized)
  ) {
    return "authentication";
  }
  if (status === 429 || /rate limit|too many requests|quota/.test(normalized)) {
    return "rate_limit";
  }
  if (
    /unsupported|unknown|invalid|extra inputs/.test(normalized) &&
    /reasoning|thinking|effort|parameter|field|option/.test(normalized)
  ) {
    return "unsupported_options";
  }
  if (/network|fetch|connect|timed? out|unavailable|econn/.test(normalized)) {
    return "unavailable";
  }
  return "provider_error";
}

export async function requestCompletion(
  req: CompletionRequest,
  deps: CompletionDeps,
  signal: AbortSignal,
): Promise<string> {
  return (await requestCompletionDetailed(req, deps, signal)).text;
}

export async function requestCompletionDetailed(
  req: CompletionRequest,
  deps: CompletionDeps,
  signal: AbortSignal,
): Promise<CompletionResult> {
  const startedAt = Date.now();
  const modelId =
    deps.modelId.trim() || DEFAULT_AUTOCOMPLETE_MODEL[deps.provider] || "";
  if (!modelId) {
    throw new Error(`No autocomplete model id set for ${deps.provider}.`);
  }
  const keys = { ...EMPTY_PROVIDER_KEYS, [deps.provider]: deps.apiKey };
  const model = await buildLanguageModel(deps.provider, keys, modelId, {
    lmstudioBaseURL: deps.lmstudioBaseURL || LMSTUDIO_DEFAULT_BASE_URL,
    mlxBaseURL: deps.mlxBaseURL,
    ollamaBaseURL: deps.ollamaBaseURL,
    openaiCompatibleBaseURL: deps.openaiCompatibleBaseURL,
  });

  const isReasoning = modelUsesReasoningTokens(deps.provider, modelId);
  const cachedCapabilities =
    deps.capabilities ??
    getCachedCompletionCapabilities({
      provider: deps.provider,
      modelId,
      lmstudioBaseURL: deps.lmstudioBaseURL,
      ollamaBaseURL: deps.ollamaBaseURL,
    });
  const plan = buildCompletionPlan({
    provider: deps.provider,
    modelId,
    declaredReasoning: isReasoning,
    profileOverride: deps.profileOverride,
    capabilities: cachedCapabilities,
  });

  for (let index = 0; index < plan.attempts.length; index++) {
    const attempt = plan.attempts[index];
    try {
      const { text } = await generateText({
        model,
        system: COMPLETION_SYSTEM_PROMPT,
        prompt: buildUserPrompt(req),
        maxOutputTokens: attempt.maxOutputTokens,
        maxRetries: 0,
        abortSignal: signal,
        ...(modelSupportsTemperature(deps.provider, modelId)
          ? { temperature: 0.1 }
          : {}),
        ...(attempt.providerOptions
          ? { providerOptions: attempt.providerOptions }
          : {}),
      });
      const cleaned = cleanCompletion(text);
      if (cleaned.trim()) {
        return {
          text: cleaned,
          profile: plan.profile,
          attemptsUsed: index + 1,
          latencyMs: Date.now() - startedAt,
        };
      }
      if (index + 1 < plan.attempts.length) continue;
      throw new CompletionRequestError(
        "empty_response",
        "The autocomplete model returned no visible text.",
      );
    } catch (error) {
      if (signal.aborted) throw error;
      const code = classifyCompletionError(error);
      if (code === "unsupported_options" && index + 1 < plan.attempts.length) {
        continue;
      }
      if (error instanceof CompletionRequestError) throw error;
      throw new CompletionRequestError(
        code,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  throw new CompletionRequestError(
    "empty_response",
    "The autocomplete model returned no visible text.",
  );
}

function cleanCompletion(raw: string): string {
  let t = raw;
  const fence = t.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1];
  t = t.replace(/^<\|cursor\|>/, "");
  return t;
}
