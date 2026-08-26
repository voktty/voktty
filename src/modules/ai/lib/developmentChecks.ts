import { native } from "./native";

export type DevelopmentCheckKind = "format" | "types" | "tests";
export type DevelopmentCheck = {
  kind: DevelopmentCheckKind;
  command: string;
  source: "package.json" | "Cargo.toml";
};

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const SCRIPT_CANDIDATES: Record<DevelopmentCheckKind, string[]> = {
  format: ["format:check", "format"],
  types: ["check-types", "typecheck", "type-check", "types"],
  tests: ["test"],
};

function packageCommand(manager: PackageManager, script: string): string {
  if (manager === "npm")
    return script === "test" ? "npm test" : `npm run ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `${manager} ${script}`;
}

export function deriveDevelopmentChecks(input: {
  packageManager: PackageManager;
  scripts: Record<string, string>;
  hasCargo: boolean;
}): DevelopmentCheck[] {
  const checks: DevelopmentCheck[] = [];
  for (const kind of ["format", "types", "tests"] as const) {
    const script = SCRIPT_CANDIDATES[kind].find(
      (name) => name in input.scripts,
    );
    if (script) {
      checks.push({
        kind,
        command: packageCommand(input.packageManager, script),
        source: "package.json",
      });
    }
  }
  if (input.hasCargo) {
    checks.push(
      { kind: "format", command: "cargo fmt --check", source: "Cargo.toml" },
      {
        kind: "types",
        command: "cargo check --workspace --locked",
        source: "Cargo.toml",
      },
      {
        kind: "tests",
        command: "cargo test --workspace --locked",
        source: "Cargo.toml",
      },
    );
  }
  return checks;
}

function joinPath(root: string, name: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return root.endsWith(separator)
    ? `${root}${name}`
    : `${root}${separator}${name}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await native.readFile(path);
    return true;
  } catch {
    return false;
  }
}

export async function discoverDevelopmentChecks(
  workspaceRoot: string,
): Promise<DevelopmentCheck[]> {
  let scripts: Record<string, string> = {};
  try {
    const result = await native.readFile(
      joinPath(workspaceRoot, "package.json"),
    );
    if (result.kind === "text" && result.size <= 256 * 1024) {
      const parsed = JSON.parse(result.content) as { scripts?: unknown };
      if (parsed.scripts && typeof parsed.scripts === "object") {
        scripts = Object.fromEntries(
          Object.entries(parsed.scripts).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      }
    }
  } catch {
    // A non-JS workspace simply contributes no package checks.
  }
  let packageManager: PackageManager = "npm";
  if (await exists(joinPath(workspaceRoot, "pnpm-lock.yaml")))
    packageManager = "pnpm";
  else if (await exists(joinPath(workspaceRoot, "yarn.lock")))
    packageManager = "yarn";
  else if (
    (await exists(joinPath(workspaceRoot, "bun.lock"))) ||
    (await exists(joinPath(workspaceRoot, "bun.lockb")))
  ) {
    packageManager = "bun";
  }
  return deriveDevelopmentChecks({
    packageManager,
    scripts,
    hasCargo: await exists(joinPath(workspaceRoot, "Cargo.toml")),
  });
}
