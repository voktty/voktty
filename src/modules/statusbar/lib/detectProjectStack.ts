import { native } from "@/modules/ai/lib/native";
import { allServers } from "@/modules/lsp";
import type { LspCustomServer } from "@/modules/settings/store";

export type ProjectStackType =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "php"
  | "c_cpp"
  | "ruby"
  | "zig"
  | "swift"
  | "vue"
  | "svelte"
  | "docker"
  | "general";

export type ProjectStackInfo = {
  primaryType: ProjectStackType;
  labelKey: string;
  detectedFiles: string[];
  recommendedLspIds: string[];
  hasGit: boolean;
  hasDocker: boolean;
  hasComposer: boolean;
  hasPackageJson: boolean;
  hasCargo: boolean;
  hasPythonEnv: boolean;
};

const STACK_LABEL_KEYS: Record<ProjectStackType, string> = {
  typescript: "statusbar.stacks.typescript",
  javascript: "statusbar.stacks.javascript",
  python: "statusbar.stacks.python",
  rust: "statusbar.stacks.rust",
  go: "statusbar.stacks.go",
  php: "statusbar.stacks.php",
  c_cpp: "statusbar.stacks.cCpp",
  ruby: "statusbar.stacks.ruby",
  zig: "statusbar.stacks.zig",
  swift: "statusbar.stacks.swift",
  vue: "statusbar.stacks.vue",
  svelte: "statusbar.stacks.svelte",
  docker: "statusbar.stacks.docker",
  general: "statusbar.stacks.general",
};

export async function detectProjectStack(
  cwd: string | null | undefined,
  customServers: LspCustomServer[] = [],
): Promise<ProjectStackInfo> {
  if (!cwd) {
    return {
      primaryType: "general",
      labelKey: STACK_LABEL_KEYS.general,
      detectedFiles: [],
      recommendedLspIds: [],
      hasGit: false,
      hasDocker: false,
      hasComposer: false,
      hasPackageJson: false,
      hasCargo: false,
      hasPythonEnv: false,
    };
  }

  try {
    const entries = await native.readDir(cwd).catch(() => []);
    const fileNames = new Set(entries.map((e) => e.name));
    const detectedFiles: string[] = [];

    const hasGit = fileNames.has(".git");
    const hasDocker =
      fileNames.has("Dockerfile") ||
      fileNames.has("docker-compose.yml") ||
      fileNames.has("compose.yaml") ||
      fileNames.has("compose.yml");
    const hasComposer = fileNames.has("composer.json") || fileNames.has("artisan");
    const hasPackageJson = fileNames.has("package.json");
    const hasTsConfig = fileNames.has("tsconfig.json");
    const hasCargo = fileNames.has("Cargo.toml");
    const hasSrcTauri = fileNames.has("src-tauri");
    const hasPython =
      fileNames.has("pyproject.toml") ||
      fileNames.has("requirements.txt") ||
      fileNames.has("Pipfile") ||
      fileNames.has("setup.py") ||
      fileNames.has(".venv") ||
      fileNames.has("venv");
    const hasGo = fileNames.has("go.mod") || fileNames.has("go.work");
    const hasCpp =
      fileNames.has("CMakeLists.txt") ||
      fileNames.has("Makefile") ||
      fileNames.has("compile_commands.json") ||
      fileNames.has(".clangd");
    const hasSvelte = fileNames.has("svelte.config.js");
    const hasVue = fileNames.has("vue.config.js");
    const hasRuby = fileNames.has("Gemfile");
    const hasZig = fileNames.has("build.zig");
    const hasSwift = fileNames.has("Package.swift");

    if (hasGit) detectedFiles.push(".git");
    if (hasComposer) detectedFiles.push("composer.json");
    if (hasPackageJson) detectedFiles.push("package.json");
    if (hasTsConfig) detectedFiles.push("tsconfig.json");
    if (hasCargo) detectedFiles.push("Cargo.toml");
    if (hasSrcTauri) detectedFiles.push("src-tauri");
    if (hasGo) detectedFiles.push("go.mod");
    if (hasDocker) detectedFiles.push("Dockerfile/compose");

    let primaryType: ProjectStackType = "general";
    if (hasTsConfig || hasPackageJson) primaryType = "typescript";
    else if (hasCargo || hasSrcTauri) primaryType = "rust";
    else if (hasComposer) primaryType = "php";
    else if (hasGo) primaryType = "go";
    else if (hasPython) primaryType = "python";
    else if (hasSvelte) primaryType = "svelte";
    else if (hasVue) primaryType = "vue";
    else if (hasCpp) primaryType = "c_cpp";
    else if (hasRuby) primaryType = "ruby";
    else if (hasZig) primaryType = "zig";
    else if (hasSwift) primaryType = "swift";
    else if (hasDocker) primaryType = "docker";

    const servers = allServers(customServers);
    const recommendedLspIds: string[] = [];

    for (const s of servers) {
      if (s.rootMarkers.some((m) => fileNames.has(m))) {
        recommendedLspIds.push(s.id);
      }
    }

    if (hasComposer && !recommendedLspIds.includes("intelephense")) {
      recommendedLspIds.push("intelephense");
    }
    if (hasPython && !recommendedLspIds.includes("pyright")) {
      recommendedLspIds.push("pyright", "ruff");
    }
    if ((hasPackageJson || hasTsConfig) && !recommendedLspIds.includes("typescript")) {
      recommendedLspIds.push("typescript");
    }
    if ((hasCargo || hasSrcTauri) && !recommendedLspIds.includes("rust-analyzer")) {
      recommendedLspIds.push("rust-analyzer");
    }
    if (hasGo && !recommendedLspIds.includes("gopls")) {
      recommendedLspIds.push("gopls");
    }
    if (hasCpp && !recommendedLspIds.includes("clangd")) {
      recommendedLspIds.push("clangd");
    }

    return {
      primaryType,
      labelKey: STACK_LABEL_KEYS[primaryType],
      detectedFiles,
      recommendedLspIds,
      hasGit,
      hasDocker,
      hasComposer,
      hasPackageJson,
      hasCargo,
      hasPythonEnv: hasPython,
    };
  } catch {
    return {
      primaryType: "general",
      labelKey: STACK_LABEL_KEYS.general,
      detectedFiles: [],
      recommendedLspIds: [],
      hasGit: false,
      hasDocker: false,
      hasComposer: false,
      hasPackageJson: false,
      hasCargo: false,
      hasPythonEnv: false,
    };
  }
}
