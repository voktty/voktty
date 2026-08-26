import { DEFAULT_MODEL_ID } from "@/modules/ai/config";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { requireAiRuntime } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { generateText } from "ai";
import { readFileText } from "./externalFormat";

export type InlineEditParams = {
  instruction: string;
  code: string;
  path?: string;
  language?: string;
  prefix?: string;
  suffix?: string;
};

export type InlineEditDeps = {
  modelId?: string;
  lmstudioBaseURL?: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
};

export function cleanCodeFences(text: string): string {
  const trimmed = text.trim();
  // Remove markdown code block wrappers ```lang ... ```
  const match = trimmed.match(
    /^```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/,
  );
  if (match) {
    return match[1];
  }
  // Single line fence
  if (
    trimmed.startsWith("```") &&
    trimmed.endsWith("```") &&
    trimmed.length >= 6
  ) {
    return trimmed.slice(3, -3).trim();
  }
  return trimmed;
}

/**
 * Extracts @file.ext mentions from natural language instructions.
 */
export function extractFileMentions(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

export async function requestInlineEdit(
  params: InlineEditParams,
  deps?: InlineEditDeps,
  signal?: AbortSignal,
): Promise<string> {
  requireAiRuntime();
  const chatState = useChatStore.getState();
  const prefsState = usePreferencesStore.getState();

  const modelId =
    deps?.modelId?.trim() || chatState.selectedModelId || DEFAULT_MODEL_ID;

  const model = await buildConfiguredLanguageModel(modelId, chatState.apiKeys, {
    lmstudioBaseURL: deps?.lmstudioBaseURL ?? prefsState.lmstudioBaseURL,
    lmstudioModelId: prefsState.lmstudioModelId,
    mlxBaseURL: deps?.mlxBaseURL ?? prefsState.mlxBaseURL,
    mlxModelId: prefsState.mlxModelId,
    ollamaBaseURL: deps?.ollamaBaseURL ?? prefsState.ollamaBaseURL,
    ollamaModelId: prefsState.ollamaModelId,
    openaiCompatibleBaseURL:
      deps?.openaiCompatibleBaseURL ?? prefsState.openaiCompatibleBaseURL,
    openaiCompatibleModelId: prefsState.openaiCompatibleModelId,
    openrouterModelId: prefsState.openrouterModelId,
    customEndpoints: prefsState.customEndpoints,
    customEndpointKeys: chatState.customEndpointKeys,
  });

  // Resolve @file mentions to inject referenced context
  const mentions = extractFileMentions(params.instruction);
  let referencedContext = "";
  if (mentions.length > 0) {
    for (const mention of mentions) {
      try {
        const fileData = await readFileText(mention);
        if (fileData?.text) {
          referencedContext += `\n[Referenced File: @${mention}]\n${fileData.text.slice(0, 4000)}\n`;
        }
      } catch {
        // Silently skip if referenced file cannot be read
      }
    }
  }

  const system = `You are a high-precision AI code refactor engine embedded in Voktty IDE.
Your task is to rewrite the provided TARGET CODE TO TRANSFORM based strictly on the user's INSTRUCTION.
Rules:
1. Return ONLY the replacement code.
2. Do NOT wrap the output in markdown code blocks (\`\`\` or \`\`\`lang).
3. Do NOT add conversational prose, explanations, or commentary.
4. Preserve existing indentation, coding style, and surround structure.`;

  const userPrompt = `File: ${params.path ?? "unknown"}
Language: ${params.language ?? "plain text"}
${referencedContext ? `\nADDITIONAL CONTEXT FROM REFERENCED FILES:${referencedContext}\n` : ""}
${params.prefix ? `Context before:\n${params.prefix.slice(-400)}\n` : ""}
TARGET CODE TO TRANSFORM:
${params.code}
${params.suffix ? `\nContext after:\n${params.suffix.slice(0, 400)}` : ""}

INSTRUCTION:
${params.instruction}`;

  const response = await generateText({
    model,
    system,
    prompt: userPrompt,
    abortSignal: signal,
  });

  return cleanCodeFences(response.text);
}
