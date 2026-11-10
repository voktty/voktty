import type { AgentRoster } from "@/modules/workspace-kit/lib/configTypes";

const VALID_ADAPTERS = new Set([
  "claude",
  "claude-code",
  "codestral",
  "gemini",
  "generic",
  "groq",
  "ollama",
  "openai",
  "openrouter",
  "perplexity",
  "together",
]);

export function validateRoster(raw: string): {
  roster: AgentRoster | null;
  error?: string;
} {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return {
      roster: null,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { roster: null, error: "Roster must be a JSON object" };
  }

  const obj = doc as Record<string, unknown>;
  if (obj.version !== 1) {
    return { roster: null, error: "Field 'version': expected 1" };
  }

  if (!Array.isArray(obj.agents)) {
    return { roster: null, error: "Field 'agents': must be an array" };
  }

  const defaultAdapter =
    obj.defaults &&
    typeof obj.defaults === "object" &&
    "runtime" in obj.defaults &&
    obj.defaults.runtime &&
    typeof obj.defaults.runtime === "object" &&
    "adapter" in obj.defaults.runtime &&
    typeof (obj.defaults.runtime as Record<string, unknown>).adapter === "string"
      ? ((obj.defaults.runtime as Record<string, unknown>).adapter as string)
      : undefined;

  const names = new Set<string>();
  for (let index = 0; index < obj.agents.length; index++) {
    const agent = obj.agents[index];
    if (!agent || typeof agent !== "object") {
      return {
        roster: null,
        error: `Field 'agents.${index}': must be an object`,
      };
    }
    const a = agent as Record<string, unknown>;
    if (typeof a.name !== "string" || !a.name.trim()) {
      return {
        roster: null,
        error: `Field 'agents.${index}.name': name is required`,
      };
    }
    if (names.has(a.name)) {
      return {
        roster: null,
        error: `Field 'agents.${index}.name': duplicate agent name '${a.name}'`,
      };
    }
    names.add(a.name);

    if (typeof a.role !== "string" || !a.role.trim()) {
      return {
        roster: null,
        error: `Field 'agents.${index}.role': role path is required`,
      };
    }

    const runtime = (
      a.runtime && typeof a.runtime === "object" ? a.runtime : {}
    ) as Record<string, unknown>;
    const adapter =
      typeof runtime.adapter === "string" ? runtime.adapter : defaultAdapter;

    if (!adapter || !VALID_ADAPTERS.has(adapter)) {
      return {
        roster: null,
        error: `Field 'agents.${index}.runtime.adapter': invalid or missing adapter`,
      };
    }

    if (
      adapter === "generic" &&
      (typeof runtime.command !== "string" || !runtime.command.trim())
    ) {
      return {
        roster: null,
        error: `Field 'agents.${index}.runtime.command': generic adapter requires a command`,
      };
    }

    if (runtime.command !== undefined && adapter !== "generic") {
      return {
        roster: null,
        error: `Field 'agents.${index}.runtime.command': command is only valid for generic adapter`,
      };
    }
  }

  return { roster: doc as AgentRoster };
}
