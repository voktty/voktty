import { DEFAULT_MODEL_ID } from "@/modules/ai/config";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { requireAiRuntime } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { generateText } from "ai";
import type { WorkspaceEnv } from "@/modules/workspace";
import { createInlineReferenceReader } from "@/modules/editor/lib/inlineEditReferences";

let pending = 0;
const MAX_PENDING = 256;

export type InlineEditParams = {
  instruction: string;
  code: string;
  path?: string;
  language?: string;
  prefix?: string;
  suffix?: string;
  workspaceEnv: WorkspaceEnv;
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
  if (pending >= MAX_PENDING)
    throw new Error("Inline edit request capacity exceeded.");
  const input = { ...params };
  const readReference = createInlineReferenceReader(
    input.path,
    input.workspaceEnv,
  );
  const current = () => !signal?.aborted;
  const assertCurrent = () => {
    if (!current()) throw new Error("Inline edit request was cancelled.");
  };
  assertCurrent();
  pending++;
  try {
    const chatState = useChatStore.getState();
    const prefsState = usePreferencesStore.getState();

    const modelId =
      deps?.modelId?.trim() || chatState.selectedModelId || DEFAULT_MODEL_ID;

    const model = await buildConfiguredLanguageModel(
      modelId,
      chatState.apiKeys,
      {
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
      },
    );
    assertCurrent();

    // Resolve @file mentions to inject referenced context
    const mentions = extractFileMentions(input.instruction).slice(0, 16);
    let referencedContext = "";
    if (mentions.length > 0) {
      for (const mention of mentions) {
        try {
          assertCurrent();
          const text = await readReference(mention, current);
          assertCurrent();
          if (text) {
            referencedContext += `\n[Referenced File: @${mention}]\n${text}\n`;
          }
        } catch {
          // Silently skip if referenced file cannot be read
        }
      }
    }
    assertCurrent();

    const system = `You are a high-precision AI code refactor engine embedded in Voktty IDE.
Your task is to rewrite the provided TARGET CODE TO TRANSFORM based strictly on the user's INSTRUCTION.
Rules:
1. Return ONLY the replacement code.
2. Do NOT wrap the output in markdown code blocks (\`\`\` or \`\`\`lang).
3. Do NOT add conversational prose, explanations, or commentary.
4. Preserve existing indentation, coding style, and surround structure.`;

    const userPrompt = `File: ${input.path ?? "unknown"}
Language: ${input.language ?? "plain text"}
${referencedContext ? `\nADDITIONAL CONTEXT FROM REFERENCED FILES:${referencedContext}\n` : ""}
${input.prefix ? `Context before:\n${input.prefix.slice(-400)}\n` : ""}
TARGET CODE TO TRANSFORM:
${input.code}
${input.suffix ? `\nContext after:\n${input.suffix.slice(0, 400)}` : ""}

INSTRUCTION:
${input.instruction}`;

    const response = await generateText({
      model,
      system,
      prompt: userPrompt,
      abortSignal: signal,
    });
    assertCurrent();
    return cleanCodeFences(response.text);
  } finally {
    pending--;
  }
}
