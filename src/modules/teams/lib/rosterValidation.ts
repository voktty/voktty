import type { AgentRoster } from "@/modules/workspace-kit/lib/configTypes";

export const ORCHESTRATOR_ROLE = "roles/orchestrator.md";

export function isOrchestratorRole(role?: string): boolean {
  return role === ORCHESTRATOR_ROLE;
}

/**
 * Checks whether a requested model identifier is forbidden according to team policies.
 *
 * Evaluation rules (case-insensitive, evaluated fail-closed):
 * 1. Global wildcard: "*" forbids all models.
 * 2. Wildcard pattern: patterns containing "*" (e.g. "gpt-4*") are converted to regex matching
 *    the entire model identifier.
 * 3. Exact and substring match: "haiku" matches exact "haiku" or any substring (e.g. "claude-3-haiku-20240307").
 *    Substring matching is intentional to prevent policy bypasses via provider-specific version suffixes.
 */
export function isModelForbidden(
  model: string,
  forbiddenOrRoster?:
    | readonly string[]
    | string[]
    | { policies?: { forbiddenModels?: readonly string[] | string[] } },
): boolean {
  if (!model || !forbiddenOrRoster) return false;
  const forbiddenModels = Array.isArray(forbiddenOrRoster)
    ? forbiddenOrRoster
    : "policies" in forbiddenOrRoster
      ? forbiddenOrRoster.policies?.forbiddenModels
      : undefined;
  if (!forbiddenModels || forbiddenModels.length === 0) return false;
  const m = model.toLowerCase();
  return forbiddenModels.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p === "*") return true;
    if (p.includes("*")) {
      const regex = new RegExp(
        `^${p.replace(/[-\/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      return regex.test(m);
    }
    return m === p || m.includes(p);
  });
}

const VALID_ADAPTERS = new Set([
  "antigravity",
  "claude",
  "claude-code",
  "codestral",
  "codex",
  "cursor",
  "gemini",
  "generic",
  "grok",
  "groq",
  "hermes",
  "ollama",
  "openai",
  "opencode",
  "openrouter",
  "perplexity",
  "pi",
  "together",
]);

export const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function normalizeKey(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/")
    .toLowerCase();
}

function pathsOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

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

  if (obj.defaults && typeof obj.defaults === "object") {
    const defRuntime = (obj.defaults as Record<string, unknown>).runtime;
    if (defRuntime && typeof defRuntime === "object") {
      const defEffort = (defRuntime as Record<string, unknown>).effort;
      if (
        defEffort !== undefined &&
        (typeof defEffort !== "string" || !VALID_EFFORTS.has(defEffort))
      ) {
        return {
          roster: null,
          error:
            "Field 'defaults.runtime.effort': must be one of low, medium, high, xhigh, max",
        };
      }
    }
  }

  const names = new Set<string>();
  const allNames = new Set<string>(
    obj.agents
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => (typeof x.name === "string" ? x.name : ""))
      .filter(Boolean),
  );
  const ownershipEntries: Array<{ key: string; agentIndex: number; offset: number }> = [];

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

    // I2: roster cannot declare names that collide with copy pattern of another agent
    const copyMatch = /^(.*?)-(\d+)$/.exec(a.name);
    if (copyMatch) {
      const baseCandidate = copyMatch[1];
      const copyNum = parseInt(copyMatch[2], 10);
      if (copyNum >= 2 && copyNum <= 6 && allNames.has(baseCandidate)) {
        return {
          roster: null,
          error: `Field 'agents.${index}.name': '${a.name}' collides with copy pattern of '${baseCandidate}'`,
        };
      }
    }

    if (typeof a.role !== "string" || !a.role.trim()) {
      return {
        roster: null,
        error: `Field 'agents.${index}.role': role path is required`,
      };
    }

    if (a.supervised !== undefined && typeof a.supervised !== "boolean") {
      return {
        roster: null,
        error: `Field 'agents.${index}.supervised': must be a boolean`,
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

    if (
      runtime.effort !== undefined &&
      (typeof runtime.effort !== "string" || !VALID_EFFORTS.has(runtime.effort))
    ) {
      return {
        roster: null,
        error: `Field 'agents.${index}.runtime.effort': must be one of low, medium, high, xhigh, max`,
      };
    }

    // Validate path fields (owns, reads)
    const checkPaths = (list: unknown, fieldName: "owns" | "reads") => {
      if (list === undefined) return null;
      if (!Array.isArray(list)) {
        return `Field 'agents.${index}.${fieldName}': must be an array of paths`;
      }
      for (let offset = 0; offset < list.length; offset++) {
        const p = list[offset];
        if (typeof p !== "string") {
          return `Field 'agents.${index}.${fieldName}.${offset}': path must be a string`;
        }
        if (p.includes("..") || p.startsWith("/") || p.startsWith("\\")) {
          return `Field 'agents.${index}.${fieldName}.${offset}': path must not contain '..' or start with '/'`;
        }
        if (/[\u0000-\u001f\u007f]/.test(p)) {
          return `Field 'agents.${index}.${fieldName}.${offset}': path contains control characters`;
        }
      }
      return null;
    };

    const ownsErr = checkPaths(a.owns, "owns");
    if (ownsErr) return { roster: null, error: ownsErr };

    const readsErr = checkPaths(a.reads, "reads");
    if (readsErr) return { roster: null, error: readsErr };

    // Check ownership overlap across different agents
    if (Array.isArray(a.owns)) {
      for (let offset = 0; offset < a.owns.length; offset++) {
        const rawPath = a.owns[offset] as string;
        const key = normalizeKey(rawPath);
        for (const existing of ownershipEntries) {
          if (existing.agentIndex !== index && pathsOverlap(existing.key, key)) {
            return {
              roster: null,
              error: `Field 'agents.${index}.owns.${offset}': ownership overlaps with another agent`,
            };
          }
        }
        ownershipEntries.push({ key, agentIndex: index, offset });
      }
    }
  }

  return { roster: doc as AgentRoster };
}
