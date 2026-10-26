import { generateText, stepCountIs } from "ai";
import { DEFAULT_MODEL_ID, getModel, type ModelId } from "../config";
import { buildLanguageModel } from "../lib/agent";
import type { ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildFsTools } from "../tools/fs";
import { buildSearchTools } from "../tools/search";
import { SUBAGENTS, type SubagentType } from "./registry";
import {
  fileToolCallsFor,
  inheritFileToolCalls,
} from "@/modules/ai/lib/fileToolCalls";

const SUBAGENT_MAX_STEPS = 12;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  modelId: string;
  toolContext: ToolContext;
  lmstudioBaseURL?: string;
  onStep?: (label: string) => void;
  abortSignal?: AbortSignal;
};

type RunResult = {
  summary: string;
  stepCount: number;
  durationMs: number;
};

export async function runSubagent({
  type,
  prompt,
  keys,
  modelId,
  toolContext,
  lmstudioBaseURL,
  onStep,
  abortSignal,
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  const source = structuredClone(toolContext.getFileContext?.() ?? null);
  const boundary = structuredClone(toolContext.getFileRootContext?.() ?? null);
  const childContext: ToolContext = {
    ...toolContext,
    getFileContext: () => structuredClone(source),
    getFileRootContext: () => structuredClone(boundary),
  };
  inheritFileToolCalls(toolContext, childContext);
  const calls = fileToolCallsFor(childContext);
  const retire = () => calls.retireAll();
  const assertCurrent = () => {
    if (abortSignal?.aborted || !calls.isCurrent())
      throw new Error("The original subagent run has retired.");
  };
  abortSignal?.addEventListener("abort", retire, { once: true });
  try {
    assertCurrent();
    const readOnly: Record<string, unknown> = {
      ...buildFsTools(childContext),
      ...buildSearchTools(childContext),
    };
    const tools: Record<string, unknown> = {};
    for (const t of def.tools) {
      if (t in readOnly) tools[t] = readOnly[t];
    }

    const model = await buildLanguageModel(
      getModel(modelId as ModelId).provider,
      keys,
      getModel(modelId as ModelId).id,
      { lmstudioBaseURL },
    );
    assertCurrent();

    const start = Date.now();
    const result = await generateText({
      model,
      system: def.systemPrompt,
      prompt,
      abortSignal,
      tools: tools as Parameters<typeof generateText>[0]["tools"],
      stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
      onStepFinish: (step) => {
        if (!onStep || abortSignal?.aborted || !calls.isCurrent()) return;
        const last = step.toolCalls?.[step.toolCalls.length - 1];
        if (last) onStep(`${type}: ${last.toolName}`);
      },
    });
    assertCurrent();

    return {
      summary: result.text || "(no output)",
      stepCount: result.steps?.length ?? 0,
      durationMs: Date.now() - start,
    };
  } finally {
    abortSignal?.removeEventListener("abort", retire);
    retire();
  }
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;
