import {
  buildThreadTitlePrompt,
  parseGeneratedThreadTitle,
} from "../sessionTitle";
import { runClaudeTextPrompt } from "./claudeText";

const TITLE_TIMEOUT_MS = 45_000;

export async function generateClaudeSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
}): Promise<string | null> {
  try {
    const output = await runClaudeTextPrompt({
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
      prompt: buildThreadTitlePrompt(input.message),
      timeoutMs: TITLE_TIMEOUT_MS,
    });
    return parseGeneratedThreadTitle(output);
  } catch (error) {
    console.debug("[monocode] session title", error);
    return null;
  }
}
