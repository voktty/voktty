import type { BuiltinSkill } from "@/modules/skills/model/skills";

export const ORCHESTRATOR_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "orchestrator",
  invocation: "orchestrator",
  description: "Plan and coordinate agent work across parallel workflows.",
  scope: "builtin",
  source: "voktty",
};

/** Consume `/orchestrator` when it is used as the leading composer command. */
export function consumeOrchestratorCommand(text: string): {
  text: string;
  matched: boolean;
} {
  const match = text.match(/^\s*\/orchestrator(?=\s|$)\s*/i);
  if (!match) return { text, matched: false };
  return { text: text.slice(match[0].length), matched: true };
}
