import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
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
): Promise<string> {
  if (cwd) {
    const projectLocalConfig = await join(cwd, ".voktty", "tools.json");
    const ws = currentWorkspaceEnv();
    const exists = await invoke("fs_stat", {
      path: projectLocalConfig,
      workspace: ws,
    })
      .then(() => true)
      .catch(() => false);
    if (exists) return projectLocalConfig;
  }
  return getGlobalToolsFilePath();
}

export async function ensureToolsConfigFile(
  cwd: string | null | undefined,
): Promise<string> {
  const targetPath = await getProjectToolsFilePath(cwd);
  const ws = currentWorkspaceEnv();
  const exists = await invoke("fs_stat", { path: targetPath, workspace: ws })
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    const dir = targetPath.substring(
      0,
      Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\")),
    );
    if (dir) {
      await invoke("fs_create_dir", { path: dir, workspace: ws }).catch(
        () => {},
      );
    }
    const defaultContent: ProjectToolsConfigFile = {
      tools: DEFAULT_PROJECT_TOOLS,
    };
    await invoke("fs_write_file", {
      path: targetPath,
      content: JSON.stringify(defaultContent, null, 2),
      workspace: ws,
      source: "tools-config",
    });
  }

  return targetPath;
}

export async function loadToolsConfigFile(
  cwd: string | null | undefined,
): Promise<ConfigurableTool[]> {
  try {
    const path = await getProjectToolsFilePath(cwd);
    const ws = currentWorkspaceEnv();
    const res = await invoke<{ kind: string; content?: string }>(
      "fs_read_file",
      { path, workspace: ws },
    );
    if (res.kind === "text" && typeof res.content === "string") {
      const parsed = JSON.parse(res.content);
      if (Array.isArray(parsed.tools)) {
        return parsed.tools;
      }
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Return default tools if not found or malformed
  }
  return DEFAULT_PROJECT_TOOLS;
}
