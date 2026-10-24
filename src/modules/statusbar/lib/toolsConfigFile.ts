import {
  currentWorkspaceEnv,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
  workspaceForDocumentPath,
} from "@/modules/workspace";
import { parentPath } from "@/modules/explorer/lib/path";
import {
  toolkitCreateDir,
  toolkitRead,
  toolkitStat,
  toolkitWrite,
  type ToolkitFileTarget,
} from "@/modules/statusbar/lib/toolkitFilesystem";
import { appConfigDir, join } from "@tauri-apps/api/path";

export type ConfigurableTool = {
  id: string;
  name?: string;
  nameKey?: string;
  command: string;
  description?: string;
  descriptionKey?: string;
  category: "ai" | "setup" | "custom";
  stacks?: string[];
  tags?: string[];
  recommended?: boolean;
};

export type ProjectToolsConfigFile = {
  tools: ConfigurableTool[];
};

export const DEFAULT_PROJECT_TOOLS: ConfigurableTool[] = [
  // AI Skills & Agent Kits
  {
    id: "ag-kit-install",
    nameKey: "projectTools.agKitInstall.name",
    command: "npm install -g @vudovn/ag-kit",
    descriptionKey: "projectTools.agKitInstall.description",
    category: "ai",
    tags: ["ag-kit", "antigravity", "install", "npm", "ia"],
    recommended: true,
  },
  {
    id: "ag-kit-init",
    nameKey: "projectTools.agKitInit.name",
    command: "ag-kit init",
    descriptionKey: "projectTools.agKitInit.description",
    category: "ai",
    tags: ["ag-kit", "antigravity", "skills", "ia", "init"],
    recommended: true,
  },
  {
    id: "uipro-install",
    nameKey: "projectTools.uiproInstall.name",
    command: "npm install -g uipro-cli",
    descriptionKey: "projectTools.uiproInstall.description",
    category: "ai",
    tags: ["uipro", "install", "npm", "cli", "ia"],
    recommended: true,
  },
  {
    id: "uipro-init-gemini",
    nameKey: "projectTools.uiproInitGemini.name",
    command: "uipro init --ai gemini",
    descriptionKey: "projectTools.uiproInitGemini.description",
    category: "ai",
    tags: ["uipro", "gemini", "ai", "init", "frontend"],
    recommended: true,
  },
  {
    id: "ecc-universal-install",
    nameKey: "projectTools.eccUniversalInstall.name",
    command: "npx ecc-universal install --guided",
    descriptionKey: "projectTools.eccUniversalInstall.description",
    category: "ai",
    tags: [
      "ecc",
      "ecc-universal",
      "claude",
      "skills",
      "instincts",
      "memory",
      "security",
      "ia",
      "harness",
    ],
    recommended: true,
  },
  {
    id: "agents-skills-init",
    nameKey: "projectTools.agentsSkillsInit.name",
    command: "npx @antigravity/skills init",
    descriptionKey: "projectTools.agentsSkillsInit.description",
    category: "ai",
    tags: ["agents", "skills", "ia", "subagents"],
  },
  {
    id: "agents-md-scaffold",
    nameKey: "projectTools.agentsMdScaffold.name",
    command: "echo '# AGENTS.md - Reglas Operativas' > AGENTS.md",
    descriptionKey: "projectTools.agentsMdScaffold.description",
    category: "ai",
    tags: ["agents.md", "voktty", "protocolo", "ia"],
  },
  {
    id: "git-ai-commit",
    nameKey: "projectTools.gitAiCommit.name",
    command: "npx git-ai init",
    descriptionKey: "projectTools.gitAiCommit.description",
    category: "ai",
    tags: ["git", "commit", "ia", "hooks"],
  },

  // Setup & Tooling per language
  // PHP
  {
    id: "php-composer-init",
    nameKey: "projectTools.phpComposerInit.name",
    command: "composer init",
    descriptionKey: "projectTools.phpComposerInit.description",
    category: "setup",
    stacks: ["php"],
    tags: ["php", "composer", "init"],
  },
  {
    id: "php-composer-install",
    nameKey: "projectTools.phpComposerInstall.name",
    command: "composer install",
    descriptionKey: "projectTools.phpComposerInstall.description",
    category: "setup",
    stacks: ["php"],
    tags: ["php", "composer", "install"],
  },
  {
    id: "php-serve",
    nameKey: "projectTools.phpServe.name",
    command: "php -S localhost:8000",
    descriptionKey: "projectTools.phpServe.description",
    category: "setup",
    stacks: ["php"],
    tags: ["php", "serve", "server"],
  },

  // Python
  {
    id: "py-venv-uv",
    nameKey: "projectTools.pyVenvUv.name",
    command: "uv venv",
    descriptionKey: "projectTools.pyVenvUv.description",
    category: "setup",
    stacks: ["python"],
    tags: ["python", "venv", "uv"],
  },
  {
    id: "py-venv-std",
    nameKey: "projectTools.pyVenvStd.name",
    command: "python -m venv .venv",
    descriptionKey: "projectTools.pyVenvStd.description",
    category: "setup",
    stacks: ["python"],
    tags: ["python", "venv", "virtualenv"],
  },
  {
    id: "py-pip-install",
    nameKey: "projectTools.pyPipInstall.name",
    command: "pip install -r requirements.txt",
    descriptionKey: "projectTools.pyPipInstall.description",
    category: "setup",
    stacks: ["python"],
    tags: ["python", "pip", "install", "requirements"],
  },

  // Node / TS
  {
    id: "node-pnpm-init",
    nameKey: "projectTools.nodePnpmInit.name",
    command: "pnpm init",
    descriptionKey: "projectTools.nodePnpmInit.description",
    category: "setup",
    stacks: ["typescript", "javascript"],
    tags: ["node", "typescript", "pnpm", "init"],
  },
  {
    id: "node-tsc-init",
    nameKey: "projectTools.nodeTscInit.name",
    command: "npx tsc --init",
    descriptionKey: "projectTools.nodeTscInit.description",
    category: "setup",
    stacks: ["typescript"],
    tags: ["typescript", "tsc", "tsconfig"],
  },
  {
    id: "node-pnpm-install",
    nameKey: "projectTools.nodePnpmInstall.name",
    command: "pnpm install",
    descriptionKey: "projectTools.nodePnpmInstall.description",
    category: "setup",
    stacks: ["typescript", "javascript"],
    tags: ["node", "pnpm", "install"],
  },

  // Rust
  {
    id: "rust-cargo-init",
    nameKey: "projectTools.rustCargoInit.name",
    command: "cargo init",
    descriptionKey: "projectTools.rustCargoInit.description",
    category: "setup",
    stacks: ["rust"],
    tags: ["rust", "cargo", "init"],
  },
  {
    id: "rust-cargo-check",
    nameKey: "projectTools.rustCargoCheck.name",
    command: "cargo check",
    descriptionKey: "projectTools.rustCargoCheck.description",
    category: "setup",
    stacks: ["rust"],
    tags: ["rust", "cargo", "check"],
  },

  // Go
  {
    id: "go-mod-init",
    nameKey: "projectTools.goModInit.name",
    command: "go mod init app",
    descriptionKey: "projectTools.goModInit.description",
    category: "setup",
    stacks: ["go"],
    tags: ["go", "golang", "mod", "init"],
  },
  {
    id: "go-mod-tidy",
    nameKey: "projectTools.goModTidy.name",
    command: "go mod tidy",
    descriptionKey: "projectTools.goModTidy.description",
    category: "setup",
    stacks: ["go"],
    tags: ["go", "golang", "mod", "tidy"],
  },

  // Git
  {
    id: "git-init-repo",
    nameKey: "projectTools.gitInitRepo.name",
    command: "git init",
    descriptionKey: "projectTools.gitInitRepo.description",
    category: "setup",
    tags: ["git", "init", "repo"],
  },

  // Docker
  {
    id: "docker-init-project",
    nameKey: "projectTools.dockerInitProject.name",
    command: "docker init",
    descriptionKey: "projectTools.dockerInitProject.description",
    category: "setup",
    stacks: ["docker"],
    tags: ["docker", "compose", "init"],
  },
];

export async function getGlobalToolsFilePath(): Promise<string> {
  const configDir = await appConfigDir();
  return join(configDir, "project-tools.json");
}

export async function getProjectToolsFilePath(
  cwd: string | null | undefined,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): Promise<string> {
  return (await getToolsConfigTarget(cwd, workspace)).path;
}

function requireCurrent(current: () => boolean) {
  if (!current()) throw new Error("Toolkit request was retired");
}

export async function getToolsConfigTarget(
  cwd: string | null | undefined,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
  current: () => boolean = () => true,
): Promise<ToolkitFileTarget> {
  requireCurrent(current);
  const projectWorkspace = cwd
    ? workspaceForDocumentPath(workspace, cwd)
    : workspace;
  if (
    cwd &&
    projectWorkspace.kind !== "serial" &&
    projectWorkspace.kind !== "docker"
  ) {
    const target = {
      path: `${cwd.replace(/\\/g, "/").replace(/\/+$/, "")}/.voktty/tools.json`,
      workspace: projectWorkspace,
    };
    const exists = await toolkitStat(target, current)
      .then(() => true)
      .catch(() => false);
    requireCurrent(current);
    if (exists) return target;
  }
  const path = await getGlobalToolsFilePath();
  requireCurrent(current);
  return { path, workspace: LOCAL_WORKSPACE };
}

export async function ensureToolsConfigTarget(
  cwd: string | null | undefined,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
  current: () => boolean = () => true,
): Promise<ToolkitFileTarget> {
  const target = await getToolsConfigTarget(cwd, workspace, current);
  requireCurrent(current);
  const exists = await toolkitStat(target, current)
    .then(() => true)
    .catch(() => false);
  requireCurrent(current);
  if (!exists) {
    const dir = parentPath(target.path);
    if (dir) {
      await toolkitCreateDir({ ...target, path: dir }, current).catch(() => {});
      requireCurrent(current);
    }
    const defaultContent: ProjectToolsConfigFile = {
      tools: DEFAULT_PROJECT_TOOLS,
    };
    await toolkitWrite(
      target,
      JSON.stringify(defaultContent, null, 2),
      current,
    );
    requireCurrent(current);
  }
  return target;
}

export async function ensureToolsConfigFile(
  cwd: string | null | undefined,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): Promise<string> {
  return (await ensureToolsConfigTarget(cwd, workspace)).path;
}

export async function loadToolsConfigFile(
  cwd: string | null | undefined,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
  current: () => boolean = () => true,
): Promise<ConfigurableTool[]> {
  try {
    return (await loadToolsConfigSnapshot(cwd, workspace, current)).tools;
  } catch {
    // Return default tools if not found or malformed
  }
  return DEFAULT_PROJECT_TOOLS;
}

export async function loadToolsConfigSnapshot(
  cwd: string | null | undefined,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
  current: () => boolean = () => true,
): Promise<{ target: ToolkitFileTarget; tools: ConfigurableTool[] }> {
  const target = await getToolsConfigTarget(cwd, workspace, current);
  requireCurrent(current);
  let tools = DEFAULT_PROJECT_TOOLS;
  try {
    const content = await toolkitRead(target, current);
    requireCurrent(current);
    tools = parseToolsConfig(content) ?? DEFAULT_PROJECT_TOOLS;
  } catch {
    requireCurrent(current);
  }
  return { target, tools };
}

export function parseToolsConfig(content: string): ConfigurableTool[] | null {
  if (content.length > 1024 * 1024) return null;
  try {
    const parsed = JSON.parse(content);
    const tools = Array.isArray(parsed) ? parsed : parsed?.tools;
    if (!Array.isArray(tools) || tools.length > 256) return null;
    const ids = new Set<string>();
    for (const item of tools) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        item.id.length > 256 ||
        ids.has(item.id) ||
        typeof item.command !== "string" ||
        item.command.length > 16384 ||
        !["ai", "setup", "custom"].includes(item.category)
      )
        return null;
      ids.add(item.id);
      for (const key of ["name", "nameKey", "description", "descriptionKey"]) {
        if (
          item[key] !== undefined &&
          (typeof item[key] !== "string" || item[key].length > 16384)
        )
          return null;
      }
      for (const key of ["tags", "stacks"]) {
        if (
          item[key] !== undefined &&
          (!Array.isArray(item[key]) ||
            item[key].length > 128 ||
            item[key].some(
              (value: unknown) =>
                typeof value !== "string" || value.length > 256,
            ))
        )
          return null;
      }
      if (
        item.recommended !== undefined &&
        typeof item.recommended !== "boolean"
      )
        return null;
    }
    return tools;
  } catch {
    return null;
  }
}
