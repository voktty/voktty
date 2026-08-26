import type { ProjectScript, ScriptCategory } from "./types";

export function categorizeScriptName(name: string): ScriptCategory {
  const lower = name.toLowerCase();
  if (/^(dev|start|serve|watch|preview)/.test(lower)) return "dev";
  if (/^(build|compile|bundle|release|pack)/.test(lower)) return "build";
  if (/^(test|spec|e2e|coverage|vitest|jest)/.test(lower)) return "test";
  if (/^(lint|format|fmt|check-types|typecheck|type-check|check|clippy)/.test(lower)) return "lint";
  if (/^(docker|compose|up|down)/.test(lower)) return "docker";
  return "custom";
}

export function parsePackageJson(
  content: string,
  lockfiles: string[] = [],
): ProjectScript[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content);
  } catch {
    return [];
  }

  const scriptsObj = pkg.scripts;
  if (!scriptsObj || typeof scriptsObj !== "object") return [];

  let runner = "pnpm";
  if (lockfiles.includes("bun.lockb") || lockfiles.includes("bun.lock")) {
    runner = "bun";
  } else if (lockfiles.includes("yarn.lock")) {
    runner = "yarn";
  } else if (lockfiles.includes("package-lock.json")) {
    runner = "npm run";
  } else if (lockfiles.includes("pnpm-lock.yaml")) {
    runner = "pnpm";
  }

  const out: ProjectScript[] = [];
  const entries = Object.entries(scriptsObj as Record<string, unknown>);

  for (const [name, cmdVal] of entries) {
    if (typeof cmdVal !== "string") continue;
    const category = categorizeScriptName(name);
    const command =
      runner === "npm run" && (name === "test" || name === "start")
        ? `npm ${name}`
        : `${runner} ${name}`;

    out.push({
      id: `pkg-${name}`,
      name,
      command,
      source: "package.json",
      category,
      description: cmdVal,
    });
  }

  return sortScripts(out);
}

export function parseCargoToml(content: string): ProjectScript[] {
  if (!content.includes("[package]") && !content.includes("[workspace]")) {
    return [];
  }

  const hasBin = content.includes("[[bin]]") || content.includes("[package]");

  const scripts: ProjectScript[] = [
    {
      id: "cargo-check",
      name: "check",
      command: "cargo check",
      source: "Cargo.toml",
      category: "lint",
    },
    {
      id: "cargo-test",
      name: "test",
      command: "cargo test",
      source: "Cargo.toml",
      category: "test",
    },
    {
      id: "cargo-build",
      name: "build",
      command: "cargo build",
      source: "Cargo.toml",
      category: "build",
    },
  ];

  if (hasBin) {
    scripts.unshift({
      id: "cargo-run",
      name: "run",
      command: "cargo run",
      source: "Cargo.toml",
      category: "dev",
    });
  }

  scripts.push({
    id: "cargo-clippy",
    name: "clippy",
    command: "cargo clippy",
    source: "Cargo.toml",
    category: "lint",
  });

  return scripts;
}

export function parseMakefile(content: string): ProjectScript[] {
  const out: ProjectScript[] = [];
  const lines = content.split("\n");
  const seen = new Set<string>();

  for (const line of lines) {
    // Match target definitions like `build:`, `test: ...`
    const match = line.match(/^([a-zA-Z0-9_-]+):(?!=)/);
    if (!match) continue;
    const target = match[1].trim();
    if (target.startsWith(".") || seen.has(target)) continue;
    seen.add(target);

    out.push({
      id: `make-${target}`,
      name: target,
      command: `make ${target}`,
      source: "Makefile",
      category: categorizeScriptName(target),
    });
  }

  return sortScripts(out);
}

export function parseDockerCompose(content: string): ProjectScript[] {
  if (!content.includes("services:") && !content.includes("version:")) {
    return [];
  }

  return [
    {
      id: "docker-up",
      name: "up",
      command: "docker compose up",
      source: "docker-compose",
      category: "docker",
      description: "Start containers in foreground",
    },
    {
      id: "docker-up-d",
      name: "up -d",
      command: "docker compose up -d",
      source: "docker-compose",
      category: "docker",
      description: "Start containers detached in background",
    },
    {
      id: "docker-down",
      name: "down",
      command: "docker compose down",
      source: "docker-compose",
      category: "docker",
      description: "Stop and remove containers",
    },
    {
      id: "docker-build",
      name: "build",
      command: "docker compose build",
      source: "docker-compose",
      category: "build",
      description: "Build or rebuild services",
    },
  ];
}

export function parsePyprojectToml(content: string): ProjectScript[] {
  if (!content.includes("[project]") && !content.includes("[tool.")) {
    return [];
  }

  const scripts: ProjectScript[] = [];
  if (content.includes("pytest") || content.includes("[tool.pytest")) {
    scripts.push({
      id: "py-test",
      name: "pytest",
      command: "pytest",
      source: "pyproject",
      category: "test",
    });
  }
  if (content.includes("ruff") || content.includes("[tool.ruff")) {
    scripts.push({
      id: "py-ruff",
      name: "ruff check",
      command: "ruff check",
      source: "pyproject",
      category: "lint",
    });
  }
  if (content.includes("fastapi") || content.includes("uvicorn")) {
    scripts.push({
      id: "py-dev",
      name: "uvicorn",
      command: "uvicorn main:app --reload",
      source: "pyproject",
      category: "dev",
    });
  }

  return scripts;
}

export function parseGoMod(content: string): ProjectScript[] {
  if (!content.includes("module ")) return [];

  return [
    {
      id: "go-run",
      name: "run",
      command: "go run .",
      source: "go.mod",
      category: "dev",
    },
    {
      id: "go-test",
      name: "test",
      command: "go test ./...",
      source: "go.mod",
      category: "test",
    },
    {
      id: "go-build",
      name: "build",
      command: "go build",
      source: "go.mod",
      category: "build",
    },
  ];
}

const CATEGORY_ORDER: Record<ScriptCategory, number> = {
  dev: 1,
  build: 2,
  test: 3,
  lint: 4,
  docker: 5,
  custom: 6,
};

function sortScripts(scripts: ProjectScript[]): ProjectScript[] {
  return [...scripts].sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (catDiff !== 0) return catDiff;
    return a.name.localeCompare(b.name);
  });
}
