import { readTextFile, writeTextFile } from "@/modules/teams/lib/teamFileIo";
import type {
  AgentDefinition,
  AgentRoster,
  AgentRuntime,
} from "@/modules/workspace-kit/lib/configTypes";
import { validateRoster } from "./rosterValidation";
import { ensureTeamDirectory, normalizePath, runProjectExclusive, teamPath } from "./teamFs";
import { prepareTeamProject } from "@/modules/teams/lib/teamProject";

const AGENT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function isSafeRelativeFilePath(rel?: string): boolean {
  if (!rel || typeof rel !== "string") return false;
  const clean = rel.replace(/\\/g, "/");
  if (clean.startsWith("/") || /^[a-zA-Z]:/.test(clean)) return false;
  const parts = clean.split("/");
  for (const p of parts) {
    if (p === ".." || p === "." || !p) return false;
  }
  return true;
}

export function resolveSafeTeamPath(
  projectRoot: string,
  subPath: string,
): string {
  const normRoot = normalizePath(projectRoot).replace(/\/+$/, "");
  const teamBase = `${normRoot}/.voktty/team`;
  const cleanSub = subPath.replace(/\\/g, "/");
  if (cleanSub.startsWith("/") || /^[a-zA-Z]:/.test(cleanSub)) {
    throw new Error(
      `Security error: path traversal detected. Path '${subPath}' is absolute.`,
    );
  }
  const parts = cleanSub.split("/");
  const resolvedParts: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      throw new Error(
        `Security error: path traversal detected. Path '${subPath}' contains '..'.`,
      );
    }
    resolvedParts.push(part);
  }
  const full = `${teamBase}/${resolvedParts.join("/")}`;
  if (!full.startsWith(`${teamBase}/`)) {
    throw new Error(
      `Security error: path traversal detected. '${full}' is outside '${teamBase}'`,
    );
  }
  return full;
}

export type LegacyAgent = {
  nombre: string;
  dir?: string;
  modelo?: string;
  esfuerzo?: "low" | "medium" | "high" | "xhigh" | "max";
  inicio?: string;
  rol?: string;
  iniciar?: string;
  dueño_de?: string[];
  lee_tambien?: string[];
  [key: string]: unknown;
};

export type LegacyAgentesDoc = {
  _nota?: string;
  base?: string;
  agentes: LegacyAgent[];
  [key: string]: unknown;
};

export type LegacyImportWarning = {
  agent?: string;
  type:
    | "external_path"
    | "unmapped_field"
    | "overlapping_ownership"
    | "invalid_path"
    | "other";
  detail: string;
};

export type LegacyUnmappedField = {
  agent?: string;
  field: string;
  value: unknown;
};

export type LegacyImportPreview = {
  sourceFile: string;
  roster: AgentRoster;
  roles: Record<string, string>;
  warnings: LegacyImportWarning[];
  unmapped: LegacyUnmappedField[];
};

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

function expandBraces(pattern: string): string[] {
  const match = /^(.*?)\{(.*?)\}(.*?)$/.exec(pattern);
  if (!match) return [pattern];
  const prefix = match[1];
  const choices = match[2]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const suffix = match[3];
  const results: string[] = [];
  for (const choice of choices) {
    const expanded = `${prefix}${choice}${suffix}`;
    results.push(...expandBraces(expanded));
  }
  return results;
}

export function sanitizePathEntries(entries: string[] | undefined): {
  cleanPaths: string[];
  unmapped: string[];
} {
  if (!entries || !Array.isArray(entries)) {
    return { cleanPaths: [], unmapped: [] };
  }

  const cleanPaths: string[] = [];
  const unmapped: string[] = [];

  for (const raw of entries) {
    if (typeof raw !== "string" || !raw.trim()) continue;

    // Remove comments in parentheses like " (fuera de git)" or " (estructura)"
    const stripped = raw.replace(/\s*\(.*?\)/g, "").trim();
    if (!stripped) {
      unmapped.push(raw);
      continue;
    }

    // Split compound entries like "docker-compose.yml y .env.example"
    const subParts = stripped.includes(" y ")
      ? stripped.split(/\s+y\s+/)
      : [stripped];

    for (const part of subParts) {
      const trimmedPart = part.trim().replace(/\\/g, "/");
      // Check for brace expansions like PROMPTS/dominios/{A,B}.md
      if (trimmedPart.includes("{") && trimmedPart.includes("}")) {
        const expanded = expandBraces(trimmedPart);
        for (const exp of expanded) {
          const cleanExp = exp.trim().replace(/^\/+/, "").replace(/\\/g, "/");
          if (
            cleanExp.includes("..") ||
            cleanExp.includes(" (") ||
            cleanExp.includes(")")
          ) {
            unmapped.push(exp);
          } else {
            cleanPaths.push(cleanExp);
          }
        }
      } else {
        const clean = trimmedPart.replace(/^\/+/, "").replace(/^\\+/, "");
        if (clean.includes("..") || clean.includes(" (") || clean.includes(")")) {
          unmapped.push(part);
        } else {
          cleanPaths.push(clean);
        }
      }
    }
  }

  return { cleanPaths, unmapped };
}

export async function previewLegacyImport(
  projectRoot: string,
): Promise<LegacyImportPreview> {
  await prepareTeamProject(projectRoot);
  const sourceFile = teamPath(
    projectRoot,
    "PROMPTS",
    "sesiones",
    "agentes.json",
  );
  let rawContent: string;
  try {
    rawContent = await readTextFile(sourceFile);
  } catch (err) {
    throw new Error(
      `Legacy configuration file not found at ${sourceFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let doc: LegacyAgentesDoc;
  try {
    doc = JSON.parse(rawContent) as LegacyAgentesDoc;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in ${sourceFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!doc || !Array.isArray(doc.agentes)) {
    throw new Error(
      `Invalid legacy format: expected 'agentes' array in ${sourceFile}`,
    );
  }

  const warnings: LegacyImportWarning[] = [];
  const unmapped: LegacyUnmappedField[] = [];

  // Check root fields
  if (doc._nota) {
    unmapped.push({ field: "_nota", value: doc._nota });
  }
  if (doc.base) {
    unmapped.push({ field: "base", value: doc.base });
    warnings.push({
      type: "unmapped_field",
      detail: `Root field 'base' ('${doc.base}') is legacy system root; Voktty teams are project-scoped`,
    });
  }

  for (const [k, v] of Object.entries(doc)) {
    if (k !== "_nota" && k !== "base" && k !== "agentes") {
      unmapped.push({ field: k, value: v });
    }
  }

  const normRoot = normalizePath(projectRoot);
  const rootSegments = normRoot.split("/").filter(Boolean);
  const rootTail = rootSegments.slice(-2).join("/");

  const mappedAgents: AgentDefinition[] = [];
  const roles: Record<string, string> = {};
  const claimedOwnership: Array<{ key: string; agent: string }> = [];

  for (const agent of doc.agentes) {
    if (!agent || typeof agent !== "object") {
      throw new Error("Invalid agent entry in legacy config: must be an object");
    }
    const name = agent.nombre;
    if (!name || typeof name !== "string" || !AGENT_NAME_REGEX.test(name)) {
      throw new Error(
        `Invalid agent name '${name}': must match /^[a-zA-Z0-9_-]+$/ and contain no path separators or special characters`,
      );
    }

    const start = agent.inicio === "siempre" ? "always" : "on-demand";

    // Workdir and external path check
    let workdir: string | undefined = undefined;
    if (agent.dir) {
      const normDir = agent.dir.replace(/\\/g, "/");
      workdir = normDir;
      const isExternal =
        normDir !== rootTail &&
        normDir !== rootSegments[rootSegments.length - 1] &&
        !normRoot.endsWith(`/${normDir}`);
      if (isExternal) {
        warnings.push({
          agent: name,
          type: "external_path",
          detail: `Agent '${name}' points to external path: dir='${agent.dir}'`,
        });
      }
    }

    // Unmapped agent fields
    if (agent.iniciar) {
      unmapped.push({
        agent: name,
        field: "iniciar",
        value: agent.iniciar,
      });
      warnings.push({
        agent: name,
        type: "unmapped_field",
        detail: `Agent '${name}': field 'iniciar' ('${agent.iniciar}') will not be written to team roster`,
      });
    }

    for (const [k, v] of Object.entries(agent)) {
      if (
        ![
          "nombre",
          "dir",
          "modelo",
          "esfuerzo",
          "inicio",
          "rol",
          "iniciar",
          "dueño_de",
          "lee_tambien",
        ].includes(k)
      ) {
        unmapped.push({ agent: name, field: k, value: v });
      }
    }

    // Runtime
    const runtime: AgentRuntime = {
      adapter: "claude-code",
      model: agent.modelo || undefined,
      effort: agent.esfuerzo || undefined,
    };

    // Sanitize owns and reads
    const { cleanPaths: ownsCandidates, unmapped: unmappedOwns } =
      sanitizePathEntries(agent.dueño_de);
    for (const raw of unmappedOwns) {
      warnings.push({
        agent: name,
        type: "invalid_path",
        detail: `Agent '${name}': could not parse ownership path '${raw}'; preserved in migration notes`,
      });
      unmapped.push({ agent: name, field: "dueño_de", value: raw });
    }

    const { cleanPaths: readsCandidates, unmapped: unmappedReads } =
      sanitizePathEntries(agent.lee_tambien);
    for (const raw of unmappedReads) {
      warnings.push({
        agent: name,
        type: "invalid_path",
        detail: `Agent '${name}': could not parse read path '${raw}'; preserved in migration notes`,
      });
      unmapped.push({ agent: name, field: "lee_tambien", value: raw });
    }

    const validOwns: string[] = [];
    const validReads: string[] = [...readsCandidates];

    // Check ownership overlap across agents to ensure valid roster
    for (const p of ownsCandidates) {
      const key = normalizeKey(p);
      const overlapping = claimedOwnership.find((existing) =>
        pathsOverlap(existing.key, key),
      );
      if (overlapping) {
        warnings.push({
          agent: name,
          type: "overlapping_ownership",
          detail: `Agent '${name}': ownership path '${p}' overlaps with '${overlapping.agent}' (${overlapping.key}); moved to reads`,
        });
        if (!validReads.includes(p)) {
          validReads.push(p);
        }
      } else {
        validOwns.push(p);
        claimedOwnership.push({ key, agent: name });
      }
    }

    // B2 & I4: Determine role destination strictly under roles/
    // Orchestrator role is mapped explicitly to roles/orchestrator.md
    const isOrchestrator =
      name === "orquestador" ||
      name === "orchestrator" ||
      (typeof agent.rol === "string" &&
        (agent.rol.toLowerCase().includes("orquestador") ||
          agent.rol.toLowerCase().includes("orchestrator")));
    const targetRoleRel = isOrchestrator
      ? "roles/orchestrator.md"
      : `roles/${name}.md`;

    // Record original role in unmapped if custom
    if (agent.rol && agent.rol !== targetRoleRel) {
      unmapped.push({
        agent: name,
        field: "rol_original",
        value: agent.rol,
      });
    }

    // Read role markdown file from legacy project strictly within PROMPTS/sesiones/
    let roleContent: string | null = null;
    const legacyRoleCandidates: string[] = [];

    if (agent.rol && isSafeRelativeFilePath(agent.rol)) {
      legacyRoleCandidates.push(
        teamPath(projectRoot, "PROMPTS", "sesiones", agent.rol),
      );
    } else if (agent.rol) {
      warnings.push({
        agent: name,
        type: "invalid_path",
        detail: `Agent '${name}': unsafe role path '${agent.rol}' ignored; generated default role template`,
      });
    }

    legacyRoleCandidates.push(
      teamPath(projectRoot, "PROMPTS", "sesiones", "roles", `${name}.md`),
    );
    if (isOrchestrator) {
      legacyRoleCandidates.push(
        teamPath(
          projectRoot,
          "PROMPTS",
          "sesiones",
          "roles",
          "orquestador.md",
        ),
      );
      legacyRoleCandidates.push(
        teamPath(
          projectRoot,
          "PROMPTS",
          "sesiones",
          "roles",
          "orchestrator.md",
        ),
      );
    }

    for (const candidate of legacyRoleCandidates) {
      try {
        roleContent = await readTextFile(candidate);
        if (roleContent) break;
      } catch {
        // try next candidate
      }
    }

    if (!roleContent) {
      warnings.push({
        agent: name,
        type: "other",
        detail: `Role file for '${name}' not found; a default template was generated`,
      });
      roleContent = `# Role: ${name}\n\nAgent definition for ${name}.\n`;
    }

    roles[targetRoleRel] = roleContent;

    const agentDef: AgentDefinition = {
      name,
      role: targetRoleRel,
      start,
      runtime,
      ...(workdir ? { workdir } : {}),
      ...(validOwns.length > 0 ? { owns: validOwns } : {}),
      ...(validReads.length > 0 ? { reads: validReads } : {}),
    };

    mappedAgents.push(agentDef);
  }

  const roster: AgentRoster = {
    $schema: "./team.schema.json",
    version: 1,
    defaults: {
      runtime: {
        adapter: "claude-code",
      },
    },
    policies: {
      forbiddenModels: ["fable", "claude-fable"],
    },
    agents: mappedAgents,
  };

  const { error: rosterErr } = validateRoster(JSON.stringify(roster));
  if (rosterErr) {
    warnings.push({
      type: "other",
      detail: `Roster validation warning: ${rosterErr}`,
    });
  }

  return {
    sourceFile,
    roster,
    roles,
    warnings,
    unmapped,
  };
}

function isNotFoundError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === "ENOENT" || errorObj.code === "not_found") {
      return true;
    }
    const msg = errorObj.message || "";
    if (
      msg.includes("ENOENT") ||
      msg.includes("not found") ||
      msg.includes("No such file") ||
      msg.includes("os error 2")
    ) {
      return true;
    }
  }
  if (typeof err === "string") {
    return (
      err.includes("ENOENT") ||
      err.includes("not found") ||
      err.includes("No such file") ||
      err.includes("os error 2")
    );
  }
  return false;
}

export async function applyLegacyImport(
  projectRoot: string,
  preview: LegacyImportPreview,
): Promise<void> {
  return runProjectExclusive(projectRoot, () => applyImport(projectRoot, preview));
}

async function applyImport(projectRoot: string, preview: LegacyImportPreview): Promise<void> {
  await prepareTeamProject(projectRoot);
  // B3: Refuse to apply if roster validation fails
  const { error: rosterErr } = validateRoster(JSON.stringify(preview.roster));
  if (rosterErr) {
    throw new Error(
      `Cannot apply legacy import: roster validation failed: ${rosterErr}`,
    );
  }

  const agentsPath = resolveSafeTeamPath(projectRoot, "agents.json");
  const roleWrites = Object.entries(preview.roles).map(([relative, content]) => {
    if (!relative.startsWith("roles/") || !isSafeRelativeFilePath(relative)) {
      throw new Error("Imported roles must stay inside .voktty/team/roles");
    }
    return { path: resolveSafeTeamPath(projectRoot, relative), content };
  });

  // B3 & R3: If agents.json already exists, create backup copy before overwriting.
  // Only treat "file not found" as non-existent; if reading fails with any other error
  // or if backup copy creation fails, abort without writing any files (R3).
  let existingContent: string | null = null;
  try {
    existingContent = await readTextFile(agentsPath);
  } catch (err: unknown) {
    if (!isNotFoundError(err)) {
      throw new Error(
        `Failed to read existing team roster at ${agentsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await ensureTeamDirectory(teamPath(projectRoot, ".voktty", "team"));
  if (existingContent && existingContent.trim()) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = resolveSafeTeamPath(
      projectRoot,
      `agents.json.bak-${timestamp}`,
    );
    try {
      await writeTextFile(backupPath, existingContent);
    } catch (err: unknown) {
      throw new Error(
        `Failed to create backup copy of agents.json at ${backupPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Write agents.json safely inside .voktty/team/
  await writeTextFile(agentsPath, JSON.stringify(preview.roster, null, 2));

  // Write roles safely inside .voktty/team/
  for (const role of roleWrites) {
    await ensureTeamDirectory(role.path.slice(0, role.path.lastIndexOf("/")));
    await writeTextFile(role.path, role.content);
  }

  // Write MIGRATION.md safely inside .voktty/team/
  const migrationReportPath = resolveSafeTeamPath(projectRoot, "MIGRATION.md");
  const reportLines = [
    "# Legacy Import Report",
    "",
    `- Source: \`${preview.sourceFile}\``,
    `- Imported at: ${new Date().toISOString()}`,
    `- Agents imported: ${preview.roster.agents.length}`,
    "",
    "## Warnings",
    ...(preview.warnings.length > 0
      ? preview.warnings.map(
          (w) =>
            `- **${w.type}** ${w.agent ? `(${w.agent})` : ""}: ${w.detail}`,
        )
      : ["No warnings."]),
    "",
    "## Unmapped Legacy Fields",
    ...(preview.unmapped.length > 0
      ? preview.unmapped.map(
          (u) =>
            `- ${u.agent ? `\`${u.agent}\`.` : ""}\`${u.field}\`: \`${JSON.stringify(u.value)}\``,
        )
      : ["No unmapped fields."]),
    "",
  ];
  await writeTextFile(migrationReportPath, reportLines.join("\n"));
}
