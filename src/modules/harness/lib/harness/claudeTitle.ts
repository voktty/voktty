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
}): Promise<string | null> {
  try {
    const output = await runClaudeTextPrompt({
      cwd: input.cwd,
      prompt: buildThreadTitlePrompt(input.message),
      timeoutMs: TITLE_TIMEOUT_MS,
    });
    return parseGeneratedThreadTitle(output);
  } catch (error) {
    console.debug("[monocode] session title", error);
    return null;
  }
}
