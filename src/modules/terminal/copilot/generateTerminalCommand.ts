import { DEFAULT_MODEL_ID } from "@/modules/ai/config";
import { requireAiRuntime } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { SUPPORTED_LANGUAGES } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";

export type CopilotCommandResult = {
  command: string;
  explanation?: string;
};

export type GenerateCommandParams = {
  prompt: string;
  shell: string;
  cwd?: string | null;
  os: string;
  abortSignal?: AbortSignal;
};

export async function generateTerminalCommand(
  params: GenerateCommandParams,
): Promise<CopilotCommandResult> {
  requireAiRuntime();
  const chatState = useChatStore.getState();
  const prefsState = usePreferencesStore.getState();

  const modelId = chatState.selectedModelId || DEFAULT_MODEL_ID;
  const apiKeys = chatState.apiKeys;
  const customEndpointKeys = chatState.customEndpointKeys;

  const langId = prefsState.language ?? "en";
  const langObj = SUPPORTED_LANGUAGES.find((l) => l.id === langId);
  const langLabel = langObj
    ? `${langObj.label} (${langObj.id})`
    : "English (en)";

  const [{ generateText }, { buildConfiguredLanguageModel }] =
    await Promise.all([import("ai"), import("@/modules/ai/lib/agent")]);

  const model = await buildConfiguredLanguageModel(modelId, apiKeys, {
    lmstudioBaseURL: prefsState.lmstudioBaseURL,
    lmstudioModelId: prefsState.lmstudioModelId,
    mlxBaseURL: prefsState.mlxBaseURL,
    mlxModelId: prefsState.mlxModelId,
    ollamaBaseURL: prefsState.ollamaBaseURL,
    ollamaModelId: prefsState.ollamaModelId,
    openaiCompatibleBaseURL: prefsState.openaiCompatibleBaseURL,
    openaiCompatibleModelId: prefsState.openaiCompatibleModelId,
    openrouterModelId: prefsState.openrouterModelId,
    customEndpoints: prefsState.customEndpoints,
    customEndpointKeys,
  });

  const systemPrompt = `You are a high-performance terminal command generator embedded in Voktty AI terminal.
Environment:
- Operating System: ${params.os}
- Active Shell: ${params.shell}
- Current Working Directory: ${params.cwd || "unknown"}
- User Language: ${langLabel}

Task:
Convert the user's natural language intent into the most accurate, concise, and safe shell command for their exact OS and shell.

Format Requirement:
Respond with ONLY a raw JSON object in the following format, without markdown wrapping (\`\`\`json):
{"command": "<the exact shell command>", "explanation": "<a brief 1-sentence explanation of what the command and flags do, written in ${langLabel}>"}

Rules:
1. Return ONLY the JSON object. Do not include markdown code blocks or additional conversational text.
2. The command must be directly runnable in ${params.shell}.
3. Prioritize standard, robust commands available on ${params.os}.
4. Write the "explanation" in ${langLabel}.
5. Never generate destructive commands unless explicitly requested.`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: params.prompt,
    temperature: 0.1,
    abortSignal: params.abortSignal,
  });

  const raw = result.text.trim();
  // Strip code block wrapping if the model provided it anyway
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      command?: string;
      explanation?: string;
    };
    if (parsed && typeof parsed.command === "string") {
      return {
        command: parsed.command.trim(),
        explanation: parsed.explanation?.trim(),
      };
    }
  } catch {
    // If JSON parsing fails, extract the first non-empty line as the command
    const firstLine = cleaned
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("#"));
    const fallbackCmd = firstLine?.replace(/^[$>]\s*/, "").trim();
    if (fallbackCmd) {
      return { command: fallbackCmd };
    }
  }

  return { command: cleaned };
}
