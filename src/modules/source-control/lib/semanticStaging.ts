import { native } from "@/modules/ai/lib/native";
import type { ProviderKeys } from "@/modules/ai/lib/keyring";
import { requireAiRuntime } from "@/modules/ai/lib/runtimeAvailability";
import type { SourceControlFileEntry } from "../useSourceControlPanel";

export type SemanticCommitGroup = {
  id: string;
  type: string;
  scope: string | null;
  message: string;
  files: string[];
  reason: string;
};

const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export function buildSemanticStagingPrompt(
  files: { path: string; statusCode: string; statusLabel: string }[],
  diffSummary: string,
): string {
  return [
    "You are an expert Git assistant. Group the following changed files into logical, atomic commits following Conventional Commits.",
    "Rules:",
    "1. Each file should belong to exactly one logical group.",
    "2. Each group must have a valid Conventional Commit subject line: type(scope): subject or type: subject.",
    "3. Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
    "4. Return ONLY a valid JSON array of objects with keys: 'type', 'scope' (or null), 'message', 'files' (array of exact file path strings), 'reason'.",
    "5. Do NOT include markdown fences, extra text, or explanations outside the JSON array.",
    "",
    "Changed files:",
    files
      .map((f) => `- [${f.statusCode}] ${f.path} (${f.statusLabel})`)
      .join("\n"),
    "",
    "Diff summary:",
    diffSummary || "(Diff summary not available)",
  ].join("\n");
}

export function parseSemanticGroups(
  rawText: string,
  availableFiles: string[],
): SemanticCommitGroup[] {
  let cleaned = rawText.trim();
  // Strip code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find array start/end
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const jsonSubstring = cleaned.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSubstring);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const fileSet = new Set(availableFiles);
  const groups: SemanticCommitGroup[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const rawType =
      typeof record.type === "string"
        ? record.type.toLowerCase().trim()
        : "chore";
    const type = CONVENTIONAL_TYPES.includes(
      rawType as (typeof CONVENTIONAL_TYPES)[number],
    )
      ? rawType
      : "chore";
    const scope =
      typeof record.scope === "string" && record.scope.trim()
        ? record.scope.trim()
        : null;
    let message =
      typeof record.message === "string" ? record.message.trim() : "";
    const reason =
      typeof record.reason === "string" ? record.reason.trim() : "";

    const rawFiles = Array.isArray(record.files) ? record.files : [];
    const files: string[] = [];

    for (const f of rawFiles) {
      if (typeof f === "string") {
        const trimmed = f.trim();
        // Match exact or ending in file path
        if (fileSet.has(trimmed)) {
          files.push(trimmed);
        } else {
          const match = availableFiles.find(
            (af) => af.endsWith(trimmed) || trimmed.endsWith(af),
          );
          if (match && !files.includes(match)) {
            files.push(match);
          }
        }
      }
    }

    if (files.length === 0) continue;

    if (!message) {
      message = scope
        ? `${type}(${scope}): update ${files[0]}`
        : `${type}: update ${files[0]}`;
    } else if (!message.startsWith(`${type}`) && !message.includes(":")) {
      message = scope ? `${type}(${scope}): ${message}` : `${type}: ${message}`;
    }

    groups.push({
      id: `group-${i + 1}-${type}`,
      type,
      scope,
      message,
      files,
      reason: reason || `Changes related to ${scope || type}`,
    });
  }

  return groups;
}

export async function generateSemanticStagingGroups({
  repoRoot,
  files,
  selectedModelId,
  apiKeys,
  preferences,
}: {
  repoRoot: string;
  files: SourceControlFileEntry[];
  selectedModelId: string;
  apiKeys: ProviderKeys;
  preferences: {
    lmstudioBaseURL?: string;
    lmstudioModelId?: string;
    mlxBaseURL?: string;
    mlxModelId?: string;
    ollamaBaseURL?: string;
    ollamaModelId?: string;
    openaiCompatibleBaseURL?: string;
    openaiCompatibleModelId?: string;
    openrouterModelId?: string;
  };
}): Promise<SemanticCommitGroup[]> {
  requireAiRuntime();
  if (files.length === 0) return [];

  const [{ buildConfiguredLanguageModel }, { generateText }, diffResult] =
    await Promise.all([
      import("@/modules/ai/lib/agent"),
      import("ai"),
      native.gitDiff(repoRoot, null, false).catch(() => ({ diffText: "" })),
    ]);

  const availableFiles = files.map((f) => f.path);
  const diffSnippet = diffResult.diffText.slice(0, 30_000);

  const model = await buildConfiguredLanguageModel(
    selectedModelId,
    apiKeys,
    preferences,
  );

  const prompt = buildSemanticStagingPrompt(
    files.map((f) => ({
      path: f.path,
      statusCode: f.statusCode,
      statusLabel: f.statusLabel,
    })),
    diffSnippet,
  );

  const response = await generateText({
    model,
    system:
      "You are a strict Git semantic staging engine. Output ONLY valid JSON containing Conventional Commit file groupings.",
    prompt,
    maxOutputTokens: 2048,
    temperature: 0.1,
  });

  return parseSemanticGroups(response.text, availableFiles);
}
