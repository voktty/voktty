import type { BuiltinSkill } from "./skills";
import type { Block } from "./session";

export const OPERATOR_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "operator",
  invocation: "operator",
  description:
    "Give this thread access to Voktty sessions, folders, and notes.",
  scope: "builtin",
  source: "monocode",
};

/** Activate app access with a leading composer command. */
export function consumeOperatorCommand(text: string): {
  text: string;
  matched: boolean;
} {
  const match = text.match(/^\s*\/(?:operator|terax|voktty)(?=\s|$)\s*/i);
  if (!match) return { text, matched: false };
  return { text: text.slice(match[0].length), matched: true };
}

const LEGACY_COMMAND = /^\s*\/(?:terax|voktty)(?=\s|$)\s*/i;

export function isOperatorUserTurn(block: Block): boolean {
  return (
    block.role === "user" &&
    !block.draft &&
    !block.internal &&
    (block.monocode === true || LEGACY_COMMAND.test(block.text))
  );
}

export function operatorUserPrompt(block: Block): string {
  const legacy = block.text.match(LEGACY_COMMAND);
  if (!legacy) return block.text;
  return (
    block.text.slice(legacy[0].length).trim() ||
    "Explain what you can do in Voktty with the app CLI."
  );
}

export function operatorEnabledInThread(blocks: Block[]): boolean {
  return blocks.some(isOperatorUserTurn);
}
